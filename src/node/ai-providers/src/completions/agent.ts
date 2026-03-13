import type { AIProvider } from "../providers/base.js";
import { handleInlineCompletion } from "./inline.js";
import { handleInlineEdit } from "./nes.js";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

interface DocumentState {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

export function startCompletionsAgent(provider: AIProvider): void {
  const documents: Map<string, DocumentState> = new Map();
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    processBuffer();
  });

  function processBuffer(): void {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const msg: JsonRpcMessage = JSON.parse(body);
        handleMessage(msg);
      } catch (e) {
        console.error("Failed to parse JSON-RPC message:", e);
      }
    }
  }

  async function handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (msg.id === undefined) {
      switch (msg.method) {
        case "textDocument/didOpen": {
          const p = msg.params as { textDocument: { uri: string; languageId: string; version: number; text: string } };
          documents.set(p.textDocument.uri, {
            uri: p.textDocument.uri,
            languageId: p.textDocument.languageId,
            version: p.textDocument.version,
            content: p.textDocument.text,
          });
          break;
        }
        case "textDocument/didChange": {
          const p = msg.params as {
            textDocument: { uri: string; version: number };
            contentChanges: Array<{ range?: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }>;
          };
          const doc = documents.get(p.textDocument.uri);
          if (doc) {
            doc.version = p.textDocument.version;
            for (const change of p.contentChanges) {
              if (!change.range) {
                doc.content = change.text;
              } else {
                doc.content = applyChange(doc.content, change.range, change.text);
              }
            }
          }
          break;
        }
        case "textDocument/didClose": {
          const p = msg.params as { textDocument: { uri: string } };
          documents.delete(p.textDocument.uri);
          break;
        }
        case "initialized":
          break;
      }
      return;
    }

    switch (msg.method) {
      case "textDocument/inlineCompletion": {
        const result = await handleInlineCompletion(msg.params!, documents, provider);
        sendResponse(msg.id, result);
        break;
      }
      case "textDocument/copilotInlineEdit": {
        const result = await handleInlineEdit(msg.params!, documents, provider);
        sendResponse(msg.id, result);
        break;
      }
      case "initialize":
        sendResponse(msg.id, { capabilities: {} });
        break;
      default:
        sendError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  function sendResponse(id: string | number, result: unknown): void {
    send({ jsonrpc: "2.0", id, result });
  }

  function sendError(id: string | number, code: number, message: string): void {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  function send(msg: Record<string, unknown>): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    process.stdout.write(header + body);
  }
}

function applyChange(
  content: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  newText: string
): string {
  const lines = content.split("\n");
  const beforeLines = lines.slice(0, range.start.line);
  const startLinePrefix = (lines[range.start.line] || "").slice(0, range.start.character);
  const endLineSuffix = (lines[range.end.line] || "").slice(range.end.character);
  const afterLines = lines.slice(range.end.line + 1);

  return [...beforeLines, startLinePrefix + newText + endLineSuffix, ...afterLines].join("\n");
}
