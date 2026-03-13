import type { Message, ContentBlock, ToolCall, ToolResult } from "../providers/base.js";

export class Conversation {
  private messages: Message[] = [];
  private abortController?: AbortController;
  private providerName: string;
  private model: string;

  constructor(providerName: string, model: string) {
    this.providerName = providerName;
    this.model = model;
    this.messages.push({
      role: "system",
      content: this.buildSystemPrompt(),
    });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
    this.trimIfNeeded();
  }

  addAssistantMessage(text: string): void {
    this.messages.push({ role: "assistant", content: text });
  }

  addAssistantToolUse(text: string, toolCalls: ToolCall[]): void {
    const blocks: ContentBlock[] = [];
    if (text) blocks.push({ type: "text", text });
    for (const tc of toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    }
    this.messages.push({ role: "assistant", content: blocks });
  }

  addToolResults(results: ToolResult[], toolCalls: ToolCall[]): void {
    const blocks: ContentBlock[] = results.map((r, i) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolCallId,
      name: toolCalls[i]?.name,
      content: r.content,
    }));
    this.messages.push({ role: "user", content: blocks });
  }

  setAbortController(controller: AbortController): void {
    this.abortController = controller;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  private trimIfNeeded(): void {
    // TODO v2: Use proper tokenizers (tiktoken for OpenAI, Anthropic token counting API,
    // Gemini countTokens). This 4-chars-per-token heuristic can be off by 2x for code/non-English.
    const totalChars = this.messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);
    const estimatedTokens = totalChars / 4;

    const limits: Record<string, number> = {
      anthropic: 160000,
      openai: 100000,
      "google-gemini": 800000,
    };
    const limit = limits[this.providerName] || 100000;

    if (estimatedTokens > limit) {
      const keep = 4;
      const removed = this.messages.length - 1 - keep;
      if (removed > 0) {
        this.messages = [
          this.messages[0],
          { role: "user", content: `[Earlier conversation truncated — ${removed} messages removed]` },
          ...this.messages.slice(-keep),
        ];
      }
    }
  }

  private buildSystemPrompt(): string {
    return `You are an AI coding assistant integrated into RStudio IDE. You help users write, understand, and debug R code and related data science work.

You have access to tools that let you read files, write files, edit files, execute R code, and interact with the user's RStudio environment. Use these tools when appropriate to help the user.

When executing R code, prefer concise, idiomatic R. When editing files, make minimal targeted changes.`;
  }
}
