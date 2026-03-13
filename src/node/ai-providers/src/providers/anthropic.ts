import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider, Message, ToolDefinition, ToolCall,
  ChatResponse, Variable, ContentBlock
} from "./base.js";

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string, apiUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      baseURL: apiUrl || undefined,
    });
    this.model = model;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ChatResponse> {
    const systemMsg = messages.find(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");

    const anthropicMessages = nonSystemMsgs.map(m => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : this.toAnthropicContent(m.content),
    }));

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemMsg ? (typeof systemMsg.content === "string" ? systemMsg.content : "") : undefined,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    }, { signal });

    let text = "";
    const toolCalls: ToolCall[] = [];

    stream.on("text", (chunk) => {
      text += chunk;
      onChunk(chunk);
    });

    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };
  }

  async complete(
    prefix: string,
    suffix: string,
    language: string,
    variables: Variable[],
    signal?: AbortSignal
  ): Promise<string> {
    const varContext = variables.length > 0
      ? "\n\nVariables in scope:\n" + variables.map(v => `- ${v.name}: ${v.description}`).join("\n")
      : "";

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 200,
      temperature: 0,
      system: `Output ONLY code to insert. No markdown, no explanation, no backticks. Language: ${language}. Match the existing style exactly.`,
      messages: [{
        role: "user",
        content: `[PREFIX]${prefix}[CURSOR]${suffix}[SUFFIX]${varContext}`,
      }],
    }, { signal });

    const textBlock = response.content.find(b => b.type === "text");
    return textBlock && textBlock.type === "text" ? this.stripMarkdown(textBlock.text) : "";
  }

  private toAnthropicContent(blocks: ContentBlock[]): Anthropic.ContentBlockParam[] {
    return blocks.map(b => {
      if (b.type === "tool_use") {
        return { type: "tool_use" as const, id: b.id!, name: b.name!, input: b.input! };
      }
      if (b.type === "tool_result") {
        return { type: "tool_result" as const, tool_use_id: b.tool_use_id!, content: b.content! };
      }
      return { type: "text" as const, text: b.text! };
    });
  }

  private stripMarkdown(text: string): string {
    return text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  }
}
