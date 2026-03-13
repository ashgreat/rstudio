import { GoogleGenerativeAI, type Content, type Part, type Tool } from "@google/generative-ai";
import type {
  AIProvider, Message, ToolDefinition, ToolCall,
  ChatResponse, Variable, ContentBlock
} from "./base.js";

export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string, _apiUrl?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    _signal?: AbortSignal
  ): Promise<ChatResponse> {
    const systemMsg = messages.find(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");

    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemMsg ? (typeof systemMsg.content === "string" ? systemMsg.content : "") : undefined,
    });

    const geminiTools: Tool[] = tools.length > 0 ? [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as object,
      })),
    }] : [];

    const contents: Content[] = this.toGeminiContents(nonSystemMsgs);

    const result = await generativeModel.generateContentStream({
      contents,
      tools: geminiTools.length > 0 ? geminiTools : undefined,
    });

    let text = "";
    const toolCalls: ToolCall[] = [];

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        text += chunkText;
        onChunk(chunkText);
      }
      for (const candidate of chunk.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.functionCall) {
            toolCalls.push({
              id: `tc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args || {}) as Record<string, unknown>,
            });
          }
        }
      }
    }

    const response = await result.response;
    const usage = response.usageMetadata;

    return {
      text,
      toolCalls,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
    };
  }

  async complete(
    prefix: string, suffix: string, language: string,
    variables: Variable[], _signal?: AbortSignal
  ): Promise<string> {
    const varContext = variables.length > 0
      ? "\n\nVariables in scope:\n" + variables.map(v => `- ${v.name}: ${v.description}`).join("\n")
      : "";

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: `Output ONLY code to insert. No markdown, no explanation, no backticks. Language: ${language}. Match the existing style exactly.`,
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    });

    const result = await model.generateContent(`[PREFIX]${prefix}[CURSOR]${suffix}[SUFFIX]${varContext}`);
    const text = result.response.text();
    return this.stripMarkdown(text);
  }

  private toGeminiContents(messages: Message[]): Content[] {
    return messages.map(m => {
      const role = m.role === "assistant" ? "model" : "user";
      if (typeof m.content === "string") {
        return { role, parts: [{ text: m.content }] };
      }
      const parts: Part[] = m.content.map(b => {
        if (b.type === "tool_use") {
          return { functionCall: { name: b.name!, args: b.input || {} } };
        }
        if (b.type === "tool_result") {
          return { functionResponse: { name: b.name || b.tool_use_id!, response: { result: b.content || "" } } };
        }
        return { text: b.text || "" };
      });
      return { role, parts };
    });
  }

  private stripMarkdown(text: string): string {
    return text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  }
}
