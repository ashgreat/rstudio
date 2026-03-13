import { WebSocket } from "ws";
import type { AIProvider, ChatResponse, ToolResult } from "../providers/base.js";
import { Conversation } from "./conversation.js";
import { PAI_TOOLS, translateToolCall, translateToolResult } from "./tools.js";

const PROTOCOL_VERSION = "10.0";
const SUPPORTED_CAPABILITIES = [
  "runtime/getActiveSession",
  "runtime/getDetailedContext",
  "runtime/executeCode",
  "runtime/getConsoleContent",
  "workspace/readFileContent",
  "workspace/writeFileContent",
  "workspace/editFileContent",
  "workspace/insertIntoNewFile",
  "workspace/insertAtCursor",
  "ui/openDocument",
];

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class ProtocolHandler {
  private ws: WebSocket;
  private provider: AIProvider;
  private providerName: string;
  private model: string;
  private conversation: Conversation;
  private pendingToolCalls: Map<string | number, (result: unknown) => void> = new Map();
  private requestCounter = 0;

  constructor(ws: WebSocket, provider: AIProvider, providerName: string, model: string) {
    this.ws = ws;
    this.provider = provider;
    this.providerName = providerName;
    this.model = model;
    this.conversation = new Conversation(providerName, model);
  }

  start(): void {
    this.ws.on("message", (data: Buffer) => {
      try {
        const msg: JsonRpcMessage = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    });

    this.ws.on("close", () => {
      this.pendingToolCalls.clear();
    });
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    // Response to our tool call request
    if (msg.id !== undefined && !msg.method) {
      const resolve = this.pendingToolCalls.get(msg.id);
      if (resolve) {
        this.pendingToolCalls.delete(msg.id);
        resolve(msg.result ?? msg.error);
      }
      return;
    }

    if (msg.method) {
      switch (msg.method) {
        case "protocol/getVersion":
          this.handleGetVersion(msg);
          break;
        case "chat/sendMessage":
          await this.handleSendMessage(msg);
          break;
        case "chat/cancel":
          this.conversation.cancel();
          if (msg.id !== undefined) this.sendResponse(msg.id, { success: true });
          break;
        case "lifecycle/requestShutdown":
          if (msg.id !== undefined) this.sendResponse(msg.id, { success: true });
          setTimeout(() => process.exit(0), 1000);
          break;
        default:
          if (msg.id !== undefined) {
            this.sendError(msg.id, -32601, `Method not found: ${msg.method}`);
          }
      }
    }
  }

  private handleGetVersion(msg: JsonRpcMessage): void {
    if (msg.id === undefined) return;
    this.sendResponse(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: SUPPORTED_CAPABILITIES,
    });
  }

  private async handleSendMessage(msg: JsonRpcMessage): Promise<void> {
    const params = msg.params || {};
    const userMessage = (params.message as string) || "";

    this.conversation.addUserMessage(userMessage);

    const abortController = new AbortController();
    this.conversation.setAbortController(abortController);

    try {
      let done = false;
      while (!done) {
        const response = await this.chatWithRetry(abortController.signal);

        this.sendNotification("chat/tokenUsage", {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });

        if (response.toolCalls.length === 0) {
          this.conversation.addAssistantMessage(response.text);
          done = true;
        } else {
          this.conversation.addAssistantToolUse(response.text, response.toolCalls);

          const results: ToolResult[] = [];
          for (const tc of response.toolCalls) {
            const paiRequest = translateToolCall(tc);
            const paiResult = await this.sendToolRequest(paiRequest.method, paiRequest.params);
            results.push(translateToolResult(tc.id, paiResult));
          }

          this.conversation.addToolResults(results, response.toolCalls);
        }
      }

      this.sendNotification("chat/streamEnd", {});
      if (msg.id !== undefined) this.sendResponse(msg.id, { success: true });
    } catch (e: unknown) {
      const error = e as Error;
      if (error.name === "AbortError") {
        this.sendNotification("chat/streamEnd", { cancelled: true });
        if (msg.id !== undefined) this.sendResponse(msg.id, { success: true, cancelled: true });
      } else {
        const errorMsg = this.formatProviderError(error);
        this.sendNotification("chat/streamContent", { content: `\n\n**Error:** ${errorMsg}` });
        this.sendNotification("chat/streamEnd", { error: errorMsg });
        if (msg.id !== undefined) this.sendResponse(msg.id, { success: false, error: errorMsg });
      }
    }
  }

  private async chatWithRetry(signal: AbortSignal): Promise<ChatResponse> {
    const BACKOFF_MS = [2000, 4000, 8000];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        return await this.provider.chat(
          this.conversation.getMessages(),
          PAI_TOOLS,
          (chunk) => this.sendNotification("chat/streamContent", { content: chunk }),
          signal
        );
      } catch (e: unknown) {
        const error = e as Error & { status?: number };
        lastError = error;
        if (error.status === 429 && attempt < BACKOFF_MS.length) {
          this.sendNotification("chat/streamContent", {
            content: `\n_Rate limited. Retrying in ${BACKOFF_MS[attempt] / 1000}s..._\n`,
          });
          await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[attempt]));
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error("All retries exhausted");
  }

  private sendToolRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve) => {
      const id = ++this.requestCounter;
      this.pendingToolCalls.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });

      setTimeout(() => {
        if (this.pendingToolCalls.has(id)) {
          this.pendingToolCalls.delete(id);
          resolve({ error: "Tool execution timed out" });
        }
      }, 60000);
    });
  }

  private formatProviderError(error: Error & { status?: number }): string {
    const status = error.status;
    if (status === 401) return "API key is invalid or expired. Check your key in Preferences > Assistant.";
    if (status === 403) return "Access denied. Your API key may not have access to this model.";
    if (status === 429) return "Rate limit reached. Please wait a moment and try again.";
    if (status && status >= 500) return `The ${this.providerName} API is temporarily unavailable. Try again in a moment.`;
    if (error.message?.includes("fetch")) return `Cannot reach ${this.providerName} API. Check your network connection and proxy settings.`;
    return error.message || "An unknown error occurred.";
  }

  private sendResponse(id: string | number, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private sendError(id: string | number, code: number, message: string): void {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
