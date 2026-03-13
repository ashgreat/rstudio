export interface Message {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;        // tool name (for both tool_use and tool_result)
  input?: Record<string, unknown>;
  tool_use_id?: string;  // references the tool_use id (for tool_result)
  content?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export interface Variable {
  name: string;
  description: string;
}

export interface AIProvider {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ChatResponse>;

  complete(
    prefix: string,
    suffix: string,
    language: string,
    variables: Variable[],
    signal?: AbortSignal
  ): Promise<string>;
}

export async function createProvider(
  name: string,
  apiKey: string,
  model: string,
  apiUrl?: string
): Promise<AIProvider> {
  switch (name) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(apiKey, model, apiUrl);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(apiKey, model, apiUrl);
    }
    case "google-gemini": {
      const { GeminiProvider } = await import("./google-gemini.js");
      return new GeminiProvider(apiKey, model, apiUrl);
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
