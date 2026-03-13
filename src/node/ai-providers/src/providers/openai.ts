import OpenAI from "openai";
import type {
  AIProvider, Message, ToolDefinition, ToolCall,
  ChatResponse, Variable, ContentBlock
} from "./base.js";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, apiUrl?: string) {
    this.client = new OpenAI({
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
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        openaiMessages.push({ role: "system", content: typeof m.content === "string" ? m.content : "" });
      } else if (m.role === "assistant" && Array.isArray(m.content)) {
        openaiMessages.push(this.toOpenAIAssistantMessage(m.content));
      } else if (m.role === "user" && Array.isArray(m.content)) {
        openaiMessages.push(...this.toOpenAIToolResultMessages(m.content));
      } else {
        openaiMessages.push({ role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" });
      }
    }

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal });

    let text = "";
    const toolCalls: ToolCall[] = [];
    const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        onChunk(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallAccum.has(tc.index)) {
            toolCallAccum.set(tc.index, { id: tc.id || "", name: tc.function?.name || "", args: "" });
          }
          const accum = toolCallAccum.get(tc.index)!;
          if (tc.id) accum.id = tc.id;
          if (tc.function?.name) accum.name = tc.function.name;
          if (tc.function?.arguments) accum.args += tc.function.arguments;
        }
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    for (const [, accum] of toolCallAccum) {
      toolCalls.push({
        id: accum.id,
        name: accum.name,
        arguments: JSON.parse(accum.args || "{}"),
      });
    }

    return { text, toolCalls, inputTokens, outputTokens };
  }

  async complete(
    prefix: string, suffix: string, language: string,
    variables: Variable[], signal?: AbortSignal
  ): Promise<string> {
    const varContext = variables.length > 0
      ? "\n\nVariables in scope:\n" + variables.map(v => `- ${v.name}: ${v.description}`).join("\n")
      : "";

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: `Output ONLY code to insert. No markdown, no explanation, no backticks. Language: ${language}. Match the existing style exactly.` },
        { role: "user", content: `[PREFIX]${prefix}[CURSOR]${suffix}[SUFFIX]${varContext}` },
      ],
    }, { signal });

    const text = response.choices[0]?.message?.content || "";
    return this.stripMarkdown(text);
  }

  private toOpenAIAssistantMessage(blocks: ContentBlock[]): OpenAI.ChatCompletionAssistantMessageParam {
    const textParts = blocks.filter(b => b.type === "text").map(b => b.text).join("");
    const toolCalls = blocks.filter(b => b.type === "tool_use").map(b => ({
      id: b.id!, type: "function" as const,
      function: { name: b.name!, arguments: JSON.stringify(b.input || {}) },
    }));
    return {
      role: "assistant",
      content: textParts || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private toOpenAIToolResultMessages(blocks: ContentBlock[]): OpenAI.ChatCompletionMessageParam[] {
    const results: OpenAI.ChatCompletionMessageParam[] = [];
    const textParts: string[] = [];
    for (const b of blocks) {
      if (b.type === "tool_result") {
        results.push({ role: "tool", tool_call_id: b.tool_use_id!, content: b.content || "" });
      } else if (b.type === "text") {
        textParts.push(b.text || "");
      }
    }
    if (textParts.length > 0) {
      results.unshift({ role: "user", content: textParts.join("") });
    }
    return results;
  }

  private stripMarkdown(text: string): string {
    return text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  }
}
