# BYOK AI Providers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic, OpenAI, and Google Gemini as BYOK providers for RStudio's AI assistant (chat, completions, agent tools).

**Architecture:** A new Node.js service at `src/node/ai-providers/` speaks the same PAI WebSocket protocol (chat) and LSP stdio protocol (completions). `SessionChat.cpp` and `SessionAssistant.cpp` conditionally launch it based on provider preference. Frontend changes are minimal since the protocol is identical.

**Tech Stack:** TypeScript/Node.js (BYOK service), C++ (session backend), Java/GWT (frontend), JSON Schema (preferences)

**Spec:** `docs/superpowers/specs/2026-03-12-byok-ai-providers-design.md`

---

## File Structure

### New Files
- `src/node/ai-providers/package.json` — npm dependencies and build scripts
- `src/node/ai-providers/tsconfig.json` — TypeScript configuration
- `src/node/ai-providers/src/main.ts` — Entry point, arg parsing, mode router
- `src/node/ai-providers/src/providers/base.ts` — AIProvider interface definition
- `src/node/ai-providers/src/providers/anthropic.ts` — Anthropic Claude SDK wrapper
- `src/node/ai-providers/src/providers/openai.ts` — OpenAI SDK wrapper
- `src/node/ai-providers/src/providers/google-gemini.ts` — Google Gemini SDK wrapper
- `src/node/ai-providers/src/chat/server.ts` — WebSocket server with auth
- `src/node/ai-providers/src/chat/protocol.ts` — PAI JSON-RPC protocol handler
- `src/node/ai-providers/src/chat/tools.ts` — Tool definitions and translation
- `src/node/ai-providers/src/chat/conversation.ts` — Conversation state and context management
- `src/node/ai-providers/src/completions/agent.ts` — Stdio Content-Length framed handler
- `src/node/ai-providers/src/completions/inline.ts` — inlineCompletion handler
- `src/node/ai-providers/src/completions/nes.ts` — copilotInlineEdit handler
- `src/node/ai-providers/src/util/streaming.ts` — Stream buffer/flush utilities
- `src/node/ai-providers/src/util/prompts.ts` — System prompts for completions
- `src/node/ai-providers/tests/providers.test.ts` — Provider wrapper unit tests
- `src/node/ai-providers/tests/protocol.test.ts` — Protocol translation tests
- `src/node/ai-providers/tests/completions.test.ts` — Completion prompt/parse tests
- `src/node/ai-providers/CMakeLists.txt` — Build integration

### Modified Files
- `src/cpp/session/resources/schema/user-prefs-schema.json` — Add BYOK provider enums, model/URL prefs
- `src/cpp/session/resources/schema/user-state-schema.json` — Add API key state fields
- `src/cpp/session/session-options.json` — Add `allow-byok-providers` option
- `src/cpp/server/server-options.json` — Add server-level `allow-byok-providers`
- `src/cpp/session/modules/SessionChat.cpp` — Branch on provider, launch BYOK service
- `src/cpp/session/modules/SessionAssistant.cpp` — Branch on assistant, launch BYOK completions
- `src/gwt/src/org/rstudio/studio/client/workbench/prefs/views/AssistantPreferencesPane.java` — BYOK provider UI
- `src/gwt/src/org/rstudio/studio/client/workbench/views/chat/PaiUtil.java` — Generalize provider detection
- `src/gwt/src/org/rstudio/studio/client/workbench/views/chat/ChatPresenter.java` — Provider-aware UI
- `src/node/CMakeLists.txt` — Include ai-providers subdirectory

### Generated Files (via `Rscript scripts/generate-prefs.R` and `Rscript scripts/generate-options.R`)
- `src/gwt/src/org/rstudio/studio/client/workbench/prefs/model/UserPrefsAccessor.java`
- `src/gwt/src/org/rstudio/studio/client/workbench/prefs/model/UserStateAccessor.java`
- `src/cpp/session/include/session/prefs/UserPrefValues.hpp`
- `src/cpp/session/include/session/prefs/UserStatePrefValues.hpp`
- `src/cpp/session/include/session/SessionOptions.gen.hpp`
- `src/cpp/server/include/server/ServerOptions.gen.hpp`

---

## Chunk 1: Schema & Configuration

### Task 1: Extend user-prefs-schema.json with BYOK provider enums and preferences

**Files:**
- Modify: `src/cpp/session/resources/schema/user-prefs-schema.json:1780-1795` (assistant and chat_provider enums)
- Modify: `src/cpp/session/resources/schema/user-prefs-schema.json` (add new prefs after line 1809)

- [ ] **Step 1: Add BYOK options to `assistant` enum**

In `src/cpp/session/resources/schema/user-prefs-schema.json`, change lines 1780-1787:

```json
"assistant": {
    "type": "string",
    "enum": ["none", "posit", "copilot", "anthropic", "openai", "google-gemini"],
    "enumReadable": ["(None)", "Posit AI Next Edit Suggestions", "GitHub Copilot", "Anthropic (Claude)", "OpenAI (GPT)", "Google Gemini"],
    "default": "posit",
    "title": "AI Assistant",
    "description": "Select which AI assistant to use for code suggestions and assistance."
},
```

- [ ] **Step 2: Add BYOK options to `chat_provider` enum**

Change lines 1788-1795:

```json
"chat_provider": {
    "type": "string",
    "enum": ["none", "posit", "anthropic", "openai", "google-gemini"],
    "enumReadable": ["(None)", "Posit Assistant", "Anthropic (Claude)", "OpenAI (GPT)", "Google Gemini"],
    "default": "posit",
    "title": "Chat Provider",
    "description": "Select which AI assistant to use for chat functionality."
},
```

- [ ] **Step 3: Add model and URL preferences**

Add after the `assistant_show_messages` preference block (around line 1850):

```json
"anthropic_model": {
    "type": "string",
    "default": "claude-sonnet-4",
    "title": "Anthropic Model",
    "description": "The Anthropic model to use for AI assistance. Use model aliases (e.g. claude-sonnet-4) or specific versions (e.g. claude-sonnet-4-20250514)."
},
"openai_model": {
    "type": "string",
    "default": "gpt-4o",
    "title": "OpenAI Model",
    "description": "The OpenAI model to use for AI assistance."
},
"google_gemini_model": {
    "type": "string",
    "default": "gemini-2.5-pro",
    "title": "Google Gemini Model",
    "description": "The Google Gemini model to use for AI assistance."
},
"anthropic_api_url": {
    "type": "string",
    "default": "https://api.anthropic.com",
    "title": "Anthropic API URL",
    "description": "Base URL for the Anthropic API. Change for proxy or compatible endpoints."
},
"openai_api_url": {
    "type": "string",
    "default": "https://api.openai.com/v1",
    "title": "OpenAI API URL",
    "description": "Base URL for the OpenAI API. Change for Azure OpenAI, local models, or compatible endpoints."
},
"google_gemini_api_url": {
    "type": "string",
    "default": "",
    "title": "Google Gemini API URL",
    "description": "Base URL override for the Google Gemini API. Leave empty for the default endpoint."
},
```

- [ ] **Step 4: Commit**

```bash
git add src/cpp/session/resources/schema/user-prefs-schema.json
git commit -m "Add BYOK provider options to user preferences schema"
```

### Task 2: Add API key fields to user-state-schema.json

**Files:**
- Modify: `src/cpp/session/resources/schema/user-state-schema.json:397-399` (before closing braces)

- [ ] **Step 1: Add API key state fields**

Insert before the final closing `}` of the `properties` object (before line 399):

```json
"anthropic_api_key": {
    "type": "string",
    "default": "",
    "title": "Anthropic API Key",
    "description": "API key for Anthropic. Falls back to ANTHROPIC_API_KEY environment variable if empty."
},
"openai_api_key": {
    "type": "string",
    "default": "",
    "title": "OpenAI API Key",
    "description": "API key for OpenAI. Falls back to OPENAI_API_KEY environment variable if empty."
},
"google_gemini_api_key": {
    "type": "string",
    "default": "",
    "title": "Google Gemini API Key",
    "description": "API key for Google Gemini. Falls back to GOOGLE_API_KEY or GEMINI_API_KEY environment variable if empty."
},
```

- [ ] **Step 2: Commit**

```bash
git add src/cpp/session/resources/schema/user-state-schema.json
git commit -m "Add BYOK API key fields to user state schema"
```

### Task 3: Add session and server options

**Files:**
- Modify: `src/cpp/session/session-options.json:1000` (after PAI options in the "pai" section)
- Modify: `src/cpp/server/server-options.json` (add new section)

- [ ] **Step 1: Add `allow-byok-providers` to session-options.json**

Add a new `"byok"` section after the `"pai"` section in the `"options"` object:

```json
"byok": [
   {
      "name": "allow-byok-providers",
      "type": "bool",
      "memberName": "allowByokProviders_",
      "defaultValue": true,
      "description": "Indicates whether users can configure their own AI provider API keys (Anthropic, OpenAI, Google Gemini)."
   },
   {
      "name": "byok-node-path",
      "type": "core::FilePath",
      "memberName": "byokNodePath_",
      "description": "The path to a Node.js binary to use for BYOK AI provider processes. If empty, uses the default Node.js discovery."
   }
],
```

- [ ] **Step 2: Add `allow-byok-providers` to server-options.json**

Add a new `"byok"` section in the server `"options"` object:

```json
"byok": [
   {
      "name": "allow-byok-providers",
      "type": "bool",
      "memberName": "allowByokProviders_",
      "defaultValue": true,
      "description": "When false, prevents users from configuring their own AI provider API keys. The BYOK provider options will not appear in the preferences UI."
   }
],
```

- [ ] **Step 3: Commit**

```bash
git add src/cpp/session/session-options.json src/cpp/server/server-options.json
git commit -m "Add allow-byok-providers admin controls to session and server options"
```

### Task 4: Regenerate code from schemas

**Files:**
- Generated files listed in File Structure section above

- [ ] **Step 1: Regenerate preferences code**

```bash
cd /Volumes/ADATA\ 2GB/Dropbox/Work/RStudio
Rscript scripts/generate-prefs.R
```

Expected: Updates `UserPrefsAccessor.java`, `UserStateAccessor.java`, `UserPrefValues.hpp`, `UserStatePrefValues.hpp` with new constants and accessor methods.

- [ ] **Step 2: Regenerate options code**

```bash
Rscript scripts/generate-options.R
```

Expected: Updates `SessionOptions.gen.hpp` and `ServerOptions.gen.hpp` with `allowByokProviders()` and `byokNodePath()` accessors.

- [ ] **Step 3: Verify generated constants exist**

Check that `UserPrefsAccessor.java` now contains:
- `ASSISTANT_ANTHROPIC = "anthropic"`
- `ASSISTANT_OPENAI = "openai"`
- `ASSISTANT_GOOGLE_GEMINI = "google-gemini"`
- `CHAT_PROVIDER_ANTHROPIC = "anthropic"`
- `CHAT_PROVIDER_OPENAI = "openai"`
- `CHAT_PROVIDER_GOOGLE_GEMINI = "google-gemini"`

Check that `UserStateAccessor.java` now contains API key accessors.

- [ ] **Step 4: Commit all generated files**

```bash
git add src/gwt/src/org/rstudio/studio/client/workbench/prefs/model/UserPrefsAccessor.java
git add src/gwt/src/org/rstudio/studio/client/workbench/prefs/model/UserStateAccessor.java
git add src/cpp/session/include/session/prefs/UserPrefValues.hpp
git add src/cpp/session/include/session/prefs/UserStatePrefValues.hpp
git add src/cpp/session/include/session/SessionOptions.gen.hpp
git add src/cpp/server/include/server/ServerOptions.gen.hpp
git commit -m "Regenerate code from updated schemas and options"
```

---

## Chunk 2: Node.js BYOK Service — Foundation

### Task 5: Create project scaffold

**Files:**
- Create: `src/node/ai-providers/package.json`
- Create: `src/node/ai-providers/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@rstudio/ai-providers",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "test": "tsc && node --test dist/tests/*.test.js",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "openai": "^4.80.0",
    "@google/generative-ai": "^0.24.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd src/node/ai-providers && npm install
```

- [ ] **Step 4: Commit**

```bash
git add src/node/ai-providers/package.json src/node/ai-providers/tsconfig.json src/node/ai-providers/package-lock.json
git commit -m "Add Node.js BYOK AI providers project scaffold"
```

### Task 6: Implement provider interface and Anthropic provider

**Files:**
- Create: `src/node/ai-providers/src/providers/base.ts`
- Create: `src/node/ai-providers/src/providers/anthropic.ts`
- Create: `src/node/ai-providers/tests/providers.test.ts`

- [ ] **Step 1: Write provider interface**

Create `src/node/ai-providers/src/providers/base.ts`:

```typescript
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
```

- [ ] **Step 2: Write Anthropic provider**

Create `src/node/ai-providers/src/providers/anthropic.ts`:

```typescript
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
    return textBlock ? this.stripMarkdown(textBlock.text) : "";
  }

  private toAnthropicContent(blocks: ContentBlock[]): Anthropic.ContentBlock[] {
    return blocks.map(b => {
      if (b.type === "tool_use") {
        return { type: "tool_use" as const, id: b.id!, name: b.name!, input: b.input! };
      }
      if (b.type === "tool_result") {
        return { type: "tool_result" as const, tool_use_id: b.tool_use_id!, content: b.content! };
      }
      return { type: "text" as const, text: b.text! };
    }) as Anthropic.ContentBlock[];
  }

  private stripMarkdown(text: string): string {
    return text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/node/ai-providers/src/providers/base.ts src/node/ai-providers/src/providers/anthropic.ts
git commit -m "Add AIProvider interface and Anthropic Claude implementation"
```

### Task 7: Implement OpenAI and Gemini providers

**Files:**
- Create: `src/node/ai-providers/src/providers/openai.ts`
- Create: `src/node/ai-providers/src/providers/google-gemini.ts`

- [ ] **Step 1: Write OpenAI provider**

Create `src/node/ai-providers/src/providers/openai.ts`:

```typescript
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
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(m => {
      if (m.role === "system") {
        return { role: "system" as const, content: typeof m.content === "string" ? m.content : "" };
      }
      if (m.role === "assistant" && Array.isArray(m.content)) {
        return this.toOpenAIAssistantMessage(m.content);
      }
      if (m.role === "user" && Array.isArray(m.content)) {
        return this.toOpenAIToolResultMessages(m.content);
      }
      return { role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" };
    }).flat();

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

  private toOpenAIAssistantMessage(blocks: ContentBlock[]): OpenAI.ChatCompletionMessageParam {
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
```

- [ ] **Step 2: Write Google Gemini provider**

Create `src/node/ai-providers/src/providers/google-gemini.ts`:

```typescript
import { GoogleGenerativeAI, type GenerativeModel, type Content, type Part, type Tool } from "@google/generative-ai";
import type {
  AIProvider, Message, ToolDefinition, ToolCall,
  ChatResponse, Variable, ContentBlock
} from "./base.js";

export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private apiUrl?: string;

  constructor(apiKey: string, model: string, apiUrl?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
    this.apiUrl = apiUrl || undefined;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
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
    variables: Variable[], signal?: AbortSignal
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
```

- [ ] **Step 3: Commit**

```bash
git add src/node/ai-providers/src/providers/openai.ts src/node/ai-providers/src/providers/google-gemini.ts
git commit -m "Add OpenAI and Google Gemini provider implementations"
```

---

## Chunk 3: Node.js BYOK Service — Chat Mode

### Task 8: Implement chat WebSocket server

**Files:**
- Create: `src/node/ai-providers/src/chat/server.ts`
- Create: `src/node/ai-providers/src/chat/protocol.ts`
- Create: `src/node/ai-providers/src/chat/conversation.ts`

- [ ] **Step 1: Write WebSocket server**

Create `src/node/ai-providers/src/chat/server.ts`:

```typescript
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { ProtocolHandler } from "./protocol.js";
import type { AIProvider } from "../providers/base.js";

export function startChatServer(
  port: number,
  provider: AIProvider,
  providerName: string,
  model: string
): void {
  const authToken = process.env.RSTUDIO_CHAT_AUTH_TOKEN || "";

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", provider: providerName, model }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: "/ai-chat" });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const token = url.searchParams.get("authToken");

    if (authToken && token !== authToken) {
      ws.close(1008, "Invalid auth token");
      return;
    }

    const handler = new ProtocolHandler(ws, provider, providerName, model);
    handler.start();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`BYOK chat server listening on 127.0.0.1:${port}`);
  });

  process.on("SIGTERM", () => {
    wss.close();
    server.close();
    process.exit(0);
  });
}
```

- [ ] **Step 2: Write protocol handler**

Create `src/node/ai-providers/src/chat/protocol.ts`:

```typescript
import { WebSocket } from "ws";
import type { AIProvider, ToolDefinition, ToolCall, ToolResult } from "../providers/base.js";
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
  private peerCapabilities: Set<string> = new Set();
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

    // Request from RStudio
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
          this.sendResponse(msg.id!, { success: true });
          break;
        case "lifecycle/requestShutdown":
          this.sendResponse(msg.id!, { success: true });
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
    const params = msg.params || {};
    if (Array.isArray(params.capabilities)) {
      this.peerCapabilities = new Set(params.capabilities as string[]);
    }

    this.sendResponse(msg.id!, {
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
        const response = await this.chatWithRetry(
          abortController.signal
        );

        // Send token usage
        this.sendNotification("chat/tokenUsage", {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });

        if (response.toolCalls.length === 0) {
          this.conversation.addAssistantMessage(response.text);
          done = true;
        } else {
          // Add assistant message with tool calls
          this.conversation.addAssistantToolUse(response.text, response.toolCalls);

          // Execute each tool call via RStudio
          const results: ToolResult[] = [];
          for (const tc of response.toolCalls) {
            const paiRequest = translateToolCall(tc);
            const paiResult = await this.sendToolRequest(paiRequest.method, paiRequest.params);
            results.push(translateToolResult(tc.id, paiResult));
          }

          this.conversation.addToolResults(results);
        }
      }

      this.sendNotification("chat/streamEnd", {});
      this.sendResponse(msg.id!, { success: true });
    } catch (e: unknown) {
      const error = e as Error;
      if (error.name === "AbortError") {
        this.sendNotification("chat/streamEnd", { cancelled: true });
        this.sendResponse(msg.id!, { success: true, cancelled: true });
      } else {
        const errorMsg = this.formatProviderError(error);
        this.sendNotification("chat/streamContent", { content: `\n\n**Error:** ${errorMsg}` });
        this.sendNotification("chat/streamEnd", { error: errorMsg });
        this.sendResponse(msg.id!, { success: false, error: errorMsg });
      }
    }
  }

  private sendToolRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve) => {
      const id = ++this.requestCounter;
      this.pendingToolCalls.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });

      // 60s timeout for tool execution
      setTimeout(() => {
        if (this.pendingToolCalls.has(id)) {
          this.pendingToolCalls.delete(id);
          resolve({ error: "Tool execution timed out" });
        }
      }, 60000);
    });
  }

  private async chatWithRetry(signal: AbortSignal): Promise<ChatResponse> {
    const MAX_RETRIES = 3;
    const BACKOFF_MS = [2000, 4000, 8000];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.provider.chat(
          this.conversation.getMessages(),
          PAI_TOOLS,
          (chunk) => this.sendNotification("chat/streamContent", { content: chunk }),
          signal
        );
      } catch (e: unknown) {
        const error = e as Error & { status?: number };
        if (error.status === 429 && attempt < MAX_RETRIES) {
          this.sendNotification("chat/streamContent", {
            content: `\n_Rate limited. Retrying in ${BACKOFF_MS[attempt] / 1000}s..._\n`,
          });
          await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[attempt]));
          continue;
        }
        throw e;
      }
    }
    throw new Error("Unreachable");
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
```

- [ ] **Step 3: Write conversation state manager**

Create `src/node/ai-providers/src/chat/conversation.ts`:

```typescript
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

  addToolResults(results: ToolResult[]): void {
    const blocks: ContentBlock[] = results.map(r => ({
      type: "tool_result" as const,
      tool_use_id: r.toolCallId,
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

    // Context limits (80% threshold)
    const limits: Record<string, number> = {
      anthropic: 160000,
      openai: 100000,
      "google-gemini": 800000,
    };
    const limit = limits[this.providerName] || 100000;

    if (estimatedTokens > limit) {
      // Keep system prompt (index 0) and last 4 messages
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
```

- [ ] **Step 4: Commit**

```bash
git add src/node/ai-providers/src/chat/
git commit -m "Add chat WebSocket server with PAI protocol and conversation management"
```

### Task 9: Implement tool call translation

**Files:**
- Create: `src/node/ai-providers/src/chat/tools.ts`

- [ ] **Step 1: Write tool definitions and translation**

Create `src/node/ai-providers/src/chat/tools.ts`:

```typescript
import type { ToolDefinition, ToolCall, ToolResult } from "../providers/base.js";

export const PAI_TOOLS: ToolDefinition[] = [
  {
    name: "execute_code",
    description: "Execute R code in the user's RStudio console and return the output.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["r"], description: "Programming language" },
        code: { type: "string", description: "The code to execute" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file in the user's workspace.",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "File path or file:// URI" },
      },
      required: ["uri"],
    },
  },
  {
    name: "write_file",
    description: "Replace the entire contents of a file.",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "File path or file:// URI" },
        content: { type: "string", description: "New file content" },
      },
      required: ["uri", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a specific range within a file.",
    parameters: {
      type: "object",
      properties: {
        uri: { type: "string", description: "File path or file:// URI" },
        startRow: { type: "number", description: "Start line (0-based)" },
        startColumn: { type: "number", description: "Start column (0-based)" },
        endRow: { type: "number", description: "End line (0-based)" },
        endColumn: { type: "number", description: "End column (0-based)" },
        newText: { type: "string", description: "Replacement text" },
      },
      required: ["uri", "startRow", "startColumn", "endRow", "endColumn", "newText"],
    },
  },
  {
    name: "create_file",
    description: "Create a new untitled file with the given content.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "File content" },
        type: { type: "string", description: "File type (e.g. r_source, r_markdown)" },
      },
      required: ["content"],
    },
  },
  {
    name: "insert_at_cursor",
    description: "Insert text at the current cursor position in the active editor.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Text to insert" },
      },
      required: ["content"],
    },
  },
  {
    name: "open_document",
    description: "Open a file in the RStudio editor.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to open" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_context",
    description: "Get information about the current R session, including variables and their types.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_console",
    description: "Get recent console output.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max lines to return", default: 50 },
      },
    },
  },
];

const TOOL_TO_PAI_METHOD: Record<string, string> = {
  execute_code: "runtime/executeCode",
  read_file: "workspace/readFileContent",
  write_file: "workspace/writeFileContent",
  edit_file: "workspace/editFileContent",
  create_file: "workspace/insertIntoNewFile",
  insert_at_cursor: "workspace/insertAtCursor",
  open_document: "ui/openDocument",
  get_context: "runtime/getDetailedContext",
  get_console: "runtime/getConsoleContent",
};

export function translateToolCall(tc: ToolCall): { method: string; params: Record<string, unknown> } {
  const method = TOOL_TO_PAI_METHOD[tc.name];
  if (!method) throw new Error(`Unknown tool: ${tc.name}`);

  const args = tc.arguments;

  switch (tc.name) {
    case "execute_code":
      return {
        method,
        params: {
          language: args.language || "r",
          code: args.code as string,
          trackingId: `byok_${Date.now()}`,
          options: { captureOutput: true, capturePlot: false, timeout: 30000 },
        },
      };
    case "read_file":
      return { method, params: { uri: normalizeUri(args.uri as string) } };
    case "write_file":
      return { method, params: { uri: normalizeUri(args.uri as string), content: args.content as string } };
    case "edit_file":
      return {
        method,
        params: {
          uri: normalizeUri(args.uri as string),
          startRow: args.startRow, startColumn: args.startColumn,
          endRow: args.endRow, endColumn: args.endColumn,
          newText: args.newText as string,
        },
      };
    case "create_file":
      return { method, params: { content: args.content as string, type: args.type || "r_source" } };
    case "insert_at_cursor":
      return { method, params: { content: args.content as string } };
    case "open_document":
      return { method, params: { path: args.path as string } };
    case "get_context":
      return { method, params: {} };
    case "get_console":
      return { method, params: { limit: args.limit || 50, fromBottom: true, maxChars: 8000 } };
    default:
      return { method, params: args };
  }
}

export function translateToolResult(toolCallId: string, paiResult: unknown): ToolResult {
  const result = paiResult as Record<string, unknown>;
  if (result?.error) {
    return { toolCallId, content: `Error: ${JSON.stringify(result.error)}`, isError: true };
  }
  return { toolCallId, content: JSON.stringify(result, null, 2) };
}

function normalizeUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${path}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/node/ai-providers/src/chat/tools.ts
git commit -m "Add PAI tool call translation layer"
```

---

## Chunk 4: Node.js BYOK Service — Completions Mode

### Task 10: Implement stdio completions agent

**Files:**
- Create: `src/node/ai-providers/src/completions/agent.ts`
- Create: `src/node/ai-providers/src/completions/inline.ts`
- Create: `src/node/ai-providers/src/completions/nes.ts`
- Create: `src/node/ai-providers/src/util/prompts.ts`

- [ ] **Step 1: Write stdio Content-Length agent**

Create `src/node/ai-providers/src/completions/agent.ts`:

```typescript
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
    // Notifications (no id)
    if (msg.id === undefined) {
      switch (msg.method) {
        case "textDocument/didOpen": {
          const params = msg.params as { textDocument: { uri: string; languageId: string; version: number; text: string } };
          documents.set(params.textDocument.uri, {
            uri: params.textDocument.uri,
            languageId: params.textDocument.languageId,
            version: params.textDocument.version,
            content: params.textDocument.text,
          });
          break;
        }
        case "textDocument/didChange": {
          const params = msg.params as {
            textDocument: { uri: string; version: number };
            contentChanges: Array<{ range?: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }>;
          };
          const doc = documents.get(params.textDocument.uri);
          if (doc) {
            doc.version = params.textDocument.version;
            for (const change of params.contentChanges) {
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
          const params = msg.params as { textDocument: { uri: string } };
          documents.delete(params.textDocument.uri);
          break;
        }
        case "initialized":
          break;
      }
      return;
    }

    // Requests (have id)
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
  const startLine = range.start.line;
  const startChar = range.start.character;
  const endLine = range.end.line;
  const endChar = range.end.character;

  const before = lines.slice(0, startLine).join("\n") +
    (startLine < lines.length ? "\n" + lines[startLine].slice(0, startChar) : "");
  const after = (endLine < lines.length ? lines[endLine].slice(endChar) + "\n" : "") +
    lines.slice(endLine + 1).join("\n");

  return before + newText + after;
}
```

- [ ] **Step 2: Write inline completion handler**

Create `src/node/ai-providers/src/completions/inline.ts`:

```typescript
import type { AIProvider, Variable } from "../providers/base.js";

interface DocumentState {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

export async function handleInlineCompletion(
  params: Record<string, unknown>,
  documents: Map<string, DocumentState>,
  provider: AIProvider
): Promise<{ completions: Array<{ insertText: string; range: unknown }>; cancelled: boolean }> {
  const textDocument = params.textDocument as { uri: string; version: number };
  const position = params.position as { line: number; character: number };
  const variables = (params.variables as Array<{ name: string; description: string }>) || [];

  const doc = documents.get(textDocument.uri);
  if (!doc) return { completions: [], cancelled: false };

  const lines = doc.content.split("\n");
  const cursorLine = position.line;
  const cursorChar = position.character;

  // Split document at cursor
  const prefixLines = lines.slice(0, cursorLine);
  prefixLines.push(lines[cursorLine]?.slice(0, cursorChar) || "");
  const prefix = prefixLines.join("\n");

  const suffixLines = [lines[cursorLine]?.slice(cursorChar) || ""];
  suffixLines.push(...lines.slice(cursorLine + 1));
  const suffix = suffixLines.join("\n");

  const providerVars: Variable[] = variables.map(v => ({
    name: v.name,
    description: v.description,
  }));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const completion = await provider.complete(
      prefix, suffix, doc.languageId, providerVars, controller.signal
    );

    clearTimeout(timeout);

    if (!completion) return { completions: [], cancelled: false };

    return {
      completions: [{
        insertText: completion,
        range: {
          start: { line: cursorLine, character: cursorChar },
          end: { line: cursorLine, character: cursorChar },
        },
      }],
      cancelled: false,
    };
  } catch {
    return { completions: [], cancelled: false };
  }
}
```

- [ ] **Step 3: Write NES handler**

Create `src/node/ai-providers/src/completions/nes.ts`:

```typescript
import type { AIProvider, Variable } from "../providers/base.js";

interface DocumentState {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

export async function handleInlineEdit(
  params: Record<string, unknown>,
  documents: Map<string, DocumentState>,
  provider: AIProvider
): Promise<{ edits: Array<unknown>; cancelled: boolean }> {
  const textDocument = params.textDocument as { uri: string; version: number };
  const position = params.position as { line: number; character: number };
  const variables = (params.variables as Array<{ name: string; description: string }>) || [];

  const doc = documents.get(textDocument.uri);
  if (!doc) return { edits: [], cancelled: false };

  const lines = doc.content.split("\n");
  const cursorLine = position.line;
  const cursorChar = position.character;

  const prefixLines = lines.slice(0, cursorLine);
  prefixLines.push(lines[cursorLine]?.slice(0, cursorChar) || "");
  const prefix = prefixLines.join("\n");

  const suffixLines = [lines[cursorLine]?.slice(cursorChar) || ""];
  suffixLines.push(...lines.slice(cursorLine + 1));
  const suffix = suffixLines.join("\n");

  const providerVars: Variable[] = variables.map(v => ({
    name: v.name,
    description: v.description,
  }));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Use complete() but with NES-style prompt handled internally
    const completion = await provider.complete(
      prefix, suffix, doc.languageId, providerVars, controller.signal
    );

    clearTimeout(timeout);

    if (!completion) return { edits: [], cancelled: false };

    return {
      edits: [{
        text: completion,
        textDocument: { uri: textDocument.uri, version: doc.version },
        range: {
          start: { line: cursorLine, character: cursorChar },
          end: { line: cursorLine, character: cursorChar },
        },
        command: null,
      }],
      cancelled: false,
    };
  } catch {
    return { edits: [], cancelled: false };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/node/ai-providers/src/completions/ src/node/ai-providers/src/util/
git commit -m "Add stdio completions agent with inline completion and NES handlers"
```

### Task 11: Implement entry point

**Files:**
- Create: `src/node/ai-providers/src/main.ts`

- [ ] **Step 1: Write main entry point**

Create `src/node/ai-providers/src/main.ts`:

```typescript
import { createProvider } from "./providers/base.js";
import { startChatServer } from "./chat/server.js";
import { startCompletionsAgent } from "./completions/agent.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const provider = args.provider;
  const model = args.model;
  const apiKey = process.env.RSTUDIO_BYOK_API_KEY || "";
  const apiUrl = args["api-url"] || undefined;

  if (!apiKey) {
    console.error("RSTUDIO_BYOK_API_KEY environment variable is required");
    process.exit(1);
  }

  if (!provider || !model) {
    console.error("Usage: main.js --mode <chat|completions> --provider <name> --model <id> [--port <port>] [--api-url <url>]");
    process.exit(1);
  }

  const aiProvider = await createProvider(provider, apiKey, model, apiUrl);

  switch (args.mode) {
    case "chat": {
      const port = parseInt(args.port || "0", 10);
      if (!port) {
        console.error("--port is required for chat mode");
        process.exit(1);
      }
      startChatServer(port, aiProvider, provider, model);
      break;
    }
    case "completions":
      startCompletionsAgent(aiProvider);
      break;
    default:
      console.error(`Unknown mode: ${args.mode}. Use 'chat' or 'completions'.`);
      process.exit(1);
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      result[key] = value;
    }
  }
  return result;
}

main();
```

- [ ] **Step 2: Build the project**

```bash
cd src/node/ai-providers && npm run build
```

Expected: TypeScript compiles to `dist/` without errors.

- [ ] **Step 3: Commit**

```bash
git add src/node/ai-providers/src/main.ts
git commit -m "Add BYOK service entry point with mode routing"
```

---

## Chunk 5: C++ Backend Integration

### Task 12: Modify SessionChat.cpp to support BYOK providers

**Files:**
- Modify: `src/cpp/session/modules/SessionChat.cpp`

Key reference points from the exploration:
- `startChatBackend()` at ~line 4686 (actual process launch logic; `chatStartBackend()` is a thin RPC wrapper at ~line 4926 that calls it)
- Chat provider preference change handler at ~line 308
- RPC registration in `initialize()` at ~line 5640

- [ ] **Step 1: Add BYOK provider helper functions**

Add near the top of the anonymous namespace in SessionChat.cpp (after the existing includes and constants), a helper to check if a provider is BYOK and to resolve the BYOK service path:

```cpp
namespace {

bool isByokProvider(const std::string& provider)
{
   return provider == "anthropic" ||
          provider == "openai" ||
          provider == "google-gemini";
}

core::FilePath byokServicePath()
{
   return session::options().resourcesPath().completeChildPath("ai-providers/dist/main.js");
}

std::string resolveByokApiKey(const std::string& provider)
{
   // Check user state first
   std::string key;
   if (provider == "anthropic")
   {
      key = prefs::userState().anthropicApiKey();
      if (key.empty())
         key = core::system::getenv("ANTHROPIC_API_KEY");
   }
   else if (provider == "openai")
   {
      key = prefs::userState().openaiApiKey();
      if (key.empty())
         key = core::system::getenv("OPENAI_API_KEY");
   }
   else if (provider == "google-gemini")
   {
      key = prefs::userState().googleGeminiApiKey();
      if (key.empty())
      {
         key = core::system::getenv("GOOGLE_API_KEY");
         if (key.empty())
            key = core::system::getenv("GEMINI_API_KEY");
      }
   }
   return key;
}

std::string resolveByokModel(const std::string& provider)
{
   if (provider == "anthropic")
      return prefs::userPrefs().anthropicModel();
   else if (provider == "openai")
      return prefs::userPrefs().openaiModel();
   else if (provider == "google-gemini")
      return prefs::userPrefs().googleGeminiModel();
   return "";
}

std::string resolveByokApiUrl(const std::string& provider)
{
   if (provider == "anthropic")
      return prefs::userPrefs().anthropicApiUrl();
   else if (provider == "openai")
      return prefs::userPrefs().openaiApiUrl();
   else if (provider == "google-gemini")
      return prefs::userPrefs().googleGeminiApiUrl();
   return "";
}

} // anonymous namespace
```

- [ ] **Step 2: Modify startChatBackend to branch on provider**

In the `startChatBackend()` function (~line 4686, the actual launch logic), add a branch before the existing PAI launch code:

```cpp
// At the start of startChatBackend(), after getting the provider preference:
std::string provider = prefs::userPrefs().chatProvider();

if (isByokProvider(provider))
{
   // Check admin controls
   if (!session::options().allowByokProviders())
   {
      json::JsonRpcResponse response;
      response.setError(json::errc::Unauthorized, "BYOK providers are disabled by the administrator.");
      pResponse->setResponse(response);
      return Success();
   }

   // Resolve BYOK configuration
   std::string apiKey = resolveByokApiKey(provider);
   if (apiKey.empty())
   {
      json::JsonRpcResponse response;
      response.setError(json::errc::ParamMissing, "No API key configured for " + provider);
      pResponse->setResponse(response);
      return Success();
   }

   std::string model = resolveByokModel(provider);
   std::string apiUrl = resolveByokApiUrl(provider);

   // Find Node.js
   core::FilePath nodePath;
   if (!session::options().byokNodePath().isEmpty())
      nodePath = session::options().byokNodePath();
   else
      node_tools::findNode(&nodePath);

   if (nodePath.isEmpty())
   {
      json::JsonRpcResponse response;
      response.setError(json::errc::ExecutionError, "Node.js not found. Required for BYOK AI providers.");
      pResponse->setResponse(response);
      return Success();
   }

   // Build command args
   core::FilePath servicePath = byokServicePath();
   std::vector<std::string> args;
   args.push_back(servicePath.getAbsolutePath());
   args.push_back("--mode");
   args.push_back("chat");
   args.push_back("--port");
   args.push_back(safe_convert::numberToString(s_chatBackendPort));
   args.push_back("--provider");
   args.push_back(provider);
   args.push_back("--model");
   args.push_back(model);
   if (!apiUrl.empty())
   {
      args.push_back("--api-url");
      args.push_back(apiUrl);
   }

   // Set environment
   core::system::Options env;
   core::system::environment(&env);
   core::system::setenv(&env, "RSTUDIO_CHAT_AUTH_TOKEN", s_chatBackendAuthToken);
   core::system::setenv(&env, "RSTUDIO_BYOK_API_KEY", apiKey);

   // Pass proxy settings through
   std::string httpProxy = core::system::getenv("HTTP_PROXY");
   if (!httpProxy.empty())
      core::system::setenv(&env, "HTTP_PROXY", httpProxy);
   std::string httpsProxy = core::system::getenv("HTTPS_PROXY");
   if (!httpsProxy.empty())
      core::system::setenv(&env, "HTTPS_PROXY", httpsProxy);

   // Launch process (reuse existing ProcessSupervisor pattern)
   // ... (follow same pattern as existing PAI launch below)
}
else
{
   // Existing PAI launch code (unchanged)
}
```

- [ ] **Step 3: Modify version/update RPCs to handle BYOK**

In `chatGetVersion`, `chatCheckForUpdates`, `chatInstallUpdate`, `chatGetUpdateStatus`, add early return for BYOK:

```cpp
// At the start of each function:
std::string provider = prefs::userPrefs().chatProvider();
if (isByokProvider(provider))
{
   // Not applicable for BYOK providers
   json::Object result;
   result["notApplicable"] = true;
   pResponse->setResult(result);
   return Success();
}
```

- [ ] **Step 4: Add `byok_test_connection` RPC handler**

Add a new RPC handler. For v1, this launches the BYOK Node.js process briefly to test the connection.
TODO v2: Implement a direct HTTPS test from C++ using `core::http` to avoid process overhead.

```cpp
Error byokTestConnection(const json::JsonRpcRequest& request,
                          json::JsonRpcResponse* pResponse)
{
   std::string provider, apiKey, model, apiUrl;
   Error error = json::readParams(request.params, &provider, &apiKey, &model, &apiUrl);
   if (error)
      return error;

   // Use API key from param if provided, otherwise resolve
   if (apiKey.empty())
      apiKey = resolveByokApiKey(provider);

   if (apiKey.empty())
   {
      pResponse->setError(json::errc::ParamMissing, "No API key provided");
      return Success();
   }

   // TODO v2: Make a direct HTTPS validation request.
   // For v1, we validate that the key is non-empty and the provider is recognized.
   // The actual API validation happens when the chat backend is first started.
   json::Object result;
   result["success"] = true;
   result["provider"] = provider;
   result["model"] = model;
   result["message"] = "API key set. Connection will be validated when chat starts.";
   pResponse->setResult(result);
   return Success();
}
```

Register in `initialize()`:

```cpp
(bind(registerRpcMethod, "byok_test_connection", byokTestConnection))
```

- [ ] **Step 5: Commit**

```bash
git add src/cpp/session/modules/SessionChat.cpp
git commit -m "Add BYOK provider branching to SessionChat backend launcher"
```

### Task 13: Modify SessionAssistant.cpp for BYOK completions

**Files:**
- Modify: `src/cpp/session/modules/SessionAssistant.cpp`

Key reference: `startAgent()` at ~line 1180

- [ ] **Step 1: Add BYOK branching to startAgent()**

In `startAgent()`, add a branch similar to SessionChat.cpp:

```cpp
// After determining the assistant type:
std::string assistant = prefs::userPrefs().assistant();

if (isByokProvider(assistant))
{
   if (!session::options().allowByokProviders())
      return; // Disabled by admin

   std::string apiKey = resolveByokApiKey(assistant);
   if (apiKey.empty())
      return; // Silently fail, completions are optional

   std::string model = resolveByokModel(assistant);

   core::FilePath nodePath;
   if (!session::options().byokNodePath().isEmpty())
      nodePath = session::options().byokNodePath();
   else
      node_tools::findNode(&nodePath);

   if (nodePath.isEmpty())
      return;

   core::FilePath servicePath = byokServicePath();
   std::vector<std::string> args;
   args.push_back(servicePath.getAbsolutePath());
   args.push_back("--mode");
   args.push_back("completions");
   args.push_back("--provider");
   args.push_back(assistant);
   args.push_back("--model");
   args.push_back(model);

   std::string apiUrl = resolveByokApiUrl(assistant);
   if (!apiUrl.empty())
   {
      args.push_back("--api-url");
      args.push_back(apiUrl);
   }

   core::system::Options env;
   core::system::environment(&env);
   core::system::setenv(&env, "RSTUDIO_BYOK_API_KEY", apiKey);

   // Launch via stdio (same pattern as existing Copilot/PAI agent launch)
   // ... follow existing startAgent() pattern for process launch
}
```

- [ ] **Step 2: Handle sign-in/sign-out for BYOK**

In `assistantSignIn`, `assistantSignOut`, `assistantStatus`:

```cpp
std::string assistant = prefs::userPrefs().assistant();
if (isByokProvider(assistant))
{
   json::Object result;
   result["status"] = "OK"; // API key auth, always "signed in"
   result["user"] = provider + " (API Key)";
   pResponse->setResult(result);
   return Success();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cpp/session/modules/SessionAssistant.cpp
git commit -m "Add BYOK provider support to SessionAssistant completions agent"
```

---

## Chunk 6: GWT Frontend Changes

### Task 14: Update PaiUtil.java for BYOK provider detection

**Files:**
- Modify: `src/gwt/src/org/rstudio/studio/client/workbench/views/chat/PaiUtil.java`

- [ ] **Step 1: Add BYOK helper methods**

Add after existing methods:

```java
public boolean isChatProviderByok()
{
   String provider = getConfiguredChatProvider();
   return provider.equals(UserPrefsAccessor.CHAT_PROVIDER_ANTHROPIC) ||
          provider.equals(UserPrefsAccessor.CHAT_PROVIDER_OPENAI) ||
          provider.equals(UserPrefsAccessor.CHAT_PROVIDER_GOOGLE_GEMINI);
}

public boolean isAssistantByok()
{
   String assistant = getConfiguredAssistant();
   return assistant.equals(UserPrefsAccessor.ASSISTANT_ANTHROPIC) ||
          assistant.equals(UserPrefsAccessor.ASSISTANT_OPENAI) ||
          assistant.equals(UserPrefsAccessor.ASSISTANT_GOOGLE_GEMINI);
}

public String getChatProviderDisplayName()
{
   String provider = getConfiguredChatProvider();
   switch (provider)
   {
      case UserPrefsAccessor.CHAT_PROVIDER_ANTHROPIC: return "Claude (Anthropic)";
      case UserPrefsAccessor.CHAT_PROVIDER_OPENAI: return "GPT (OpenAI)";
      case UserPrefsAccessor.CHAT_PROVIDER_GOOGLE_GEMINI: return "Gemini (Google)";
      case UserPrefsAccessor.CHAT_PROVIDER_POSIT: return "Posit Assistant";
      default: return "";
   }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gwt/src/org/rstudio/studio/client/workbench/views/chat/PaiUtil.java
git commit -m "Add BYOK provider detection helpers to PaiUtil"
```

### Task 15: Update AssistantPreferencesPane.java

**Files:**
- Modify: `src/gwt/src/org/rstudio/studio/client/workbench/prefs/views/AssistantPreferencesPane.java`

- [ ] **Step 1: Add BYOK provider options to chat dropdown**

In the chat provider selector creation area (~line 269-307), the BYOK options should be automatically included since we updated the enum in `user-prefs-schema.json`. The generated `UserPrefsAccessor` will include the new constants. However, we need to add conditional API key input fields.

Add API key input fields that show/hide based on selected provider:

```java
// After the chat provider selector, add:
private TextBox anthropicApiKeyField_;
private TextBox openaiApiKeyField_;
private TextBox geminiApiKeyField_;
private TextBox anthropicModelField_;
private TextBox openaiModelField_;
private TextBox geminiModelField_;
private TextBox openaiApiUrlField_;

// In the UI creation method, after the provider dropdown:
anthropicApiKeyField_ = addPasswordField("Anthropic API Key:", "Uses $ANTHROPIC_API_KEY if empty");
openaiApiKeyField_ = addPasswordField("OpenAI API Key:", "Uses $OPENAI_API_KEY if empty");
geminiApiKeyField_ = addPasswordField("Google Gemini API Key:", "Uses $GOOGLE_API_KEY if empty");

anthropicModelField_ = addTextField("Anthropic Model:", prefs.anthropicModel().getGlobalValue());
openaiModelField_ = addTextField("OpenAI Model:", prefs.openaiModel().getGlobalValue());
geminiModelField_ = addTextField("Google Gemini Model:", prefs.googleGeminiModel().getGlobalValue());
openaiApiUrlField_ = addTextField("OpenAI API URL:", prefs.openaiApiUrl().getGlobalValue());

// Add change handler to show/hide fields based on selected provider
chatProviderSelector_.addChangeHandler(event -> updateByokFieldVisibility());
```

```java
private void updateByokFieldVisibility()
{
   String provider = chatProviderSelector_.getValue();
   boolean isAnthropic = provider.equals(UserPrefsAccessor.CHAT_PROVIDER_ANTHROPIC);
   boolean isOpenai = provider.equals(UserPrefsAccessor.CHAT_PROVIDER_OPENAI);
   boolean isGemini = provider.equals(UserPrefsAccessor.CHAT_PROVIDER_GOOGLE_GEMINI);

   anthropicApiKeyField_.setVisible(isAnthropic);
   anthropicModelField_.setVisible(isAnthropic);
   openaiApiKeyField_.setVisible(isOpenai);
   openaiModelField_.setVisible(isOpenai);
   openaiApiUrlField_.setVisible(isOpenai);
   geminiApiKeyField_.setVisible(isGemini);
   geminiModelField_.setVisible(isGemini);
}
```

Note: The exact widget types and method signatures will need to match the existing GWT widget patterns used in `AssistantPreferencesPane.java`. Read the file carefully and follow the existing field creation patterns.

- [ ] **Step 2: Add save logic for BYOK preferences**

In the `onApply` or save handler, persist the API keys to user state and models to user prefs:

```java
// Save API keys to user state
if (!anthropicApiKeyField_.getValue().isEmpty())
   state.anthropicApiKey().setGlobalValue(anthropicApiKeyField_.getValue());
if (!openaiApiKeyField_.getValue().isEmpty())
   state.openaiApiKey().setGlobalValue(openaiApiKeyField_.getValue());
if (!geminiApiKeyField_.getValue().isEmpty())
   state.googleGeminiApiKey().setGlobalValue(geminiApiKeyField_.getValue());

// Save models to user prefs
prefs.anthropicModel().setGlobalValue(anthropicModelField_.getValue());
prefs.openaiModel().setGlobalValue(openaiModelField_.getValue());
prefs.googleGeminiModel().setGlobalValue(geminiModelField_.getValue());
prefs.openaiApiUrl().setGlobalValue(openaiApiUrlField_.getValue());
```

- [ ] **Step 3: Add BYOK completions quality note**

When a BYOK provider is selected for completions, show an informational label:

```java
// In the completions section:
Label byokNote = new Label(
   "Note: BYOK providers may be slower for inline suggestions than Copilot or Posit AI."
);
byokNote.addStyleName("byok-completions-note");
// Show only when a BYOK provider is selected as assistant
```

- [ ] **Step 4: Commit**

```bash
git add src/gwt/src/org/rstudio/studio/client/workbench/prefs/views/AssistantPreferencesPane.java
git commit -m "Add BYOK API key and model configuration to preferences pane"
```

### Task 16: Update ChatPresenter.java for BYOK providers

**Files:**
- Modify: `src/gwt/src/org/rstudio/studio/client/workbench/views/chat/ChatPresenter.java`

- [ ] **Step 1: Update provider change handler**

In the chat provider change handler (~line 643-672), add BYOK support:

```java
// Replace the existing provider check with:
if (paiUtil_.isChatProviderPosit() || paiUtil_.isChatProviderByok())
{
   initializeChatBackend();
}
```

- [ ] **Step 2: Hide installation UI for BYOK**

Where PAI installation status is checked, add BYOK guard:

```java
// Before showing installation/update UI:
if (paiUtil_.isChatProviderByok())
{
   // Skip installation checks for BYOK providers
   // Proceed directly to starting the backend
}
```

- [ ] **Step 3: Update provider display name**

Where the chat pane header shows the provider name, use the new helper:

```java
String displayName = paiUtil_.getChatProviderDisplayName();
view_.setProviderName(displayName);
```

- [ ] **Step 4: Commit**

```bash
git add src/gwt/src/org/rstudio/studio/client/workbench/views/chat/ChatPresenter.java
git commit -m "Update ChatPresenter to support BYOK provider lifecycle"
```

---

## Chunk 7: Build Integration

### Task 17: Add CMake configuration for ai-providers

**Files:**
- Create: `src/node/ai-providers/CMakeLists.txt`
- Modify: `src/node/CMakeLists.txt`

- [ ] **Step 1: Create ai-providers CMakeLists.txt**

Create `src/node/ai-providers/CMakeLists.txt`:

```cmake
#
# CMakeLists.txt
#
# Copyright (C) 2026 by Posit Software, PBC
#
# This program is licensed to you under the terms of version 3 of the
# GNU Affero General Public License. This program is distributed WITHOUT
# ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
# MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
# AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
#

cmake_minimum_required(VERSION 3.6.3)

include(../CMakeNodeTools.txt)

if(NOT NODEJS)
   message(STATUS "Node.js not found, skipping ai-providers build")
   return()
endif()

set(AI_PROVIDERS_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(AI_PROVIDERS_DIST "${AI_PROVIDERS_DIR}/dist")

add_custom_target(ai-providers ALL
   COMMAND ${NPM} ci
   COMMAND ${NPM} run build
   COMMAND ${NPM} prune --production
   WORKING_DIRECTORY "${AI_PROVIDERS_DIR}"
   COMMENT "Building BYOK AI providers service"
)

install(
   DIRECTORY "${AI_PROVIDERS_DIST}/"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers/dist"
)

install(
   FILES "${AI_PROVIDERS_DIR}/package.json"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers"
)

install(
   DIRECTORY "${AI_PROVIDERS_DIR}/node_modules/"
   DESTINATION "${RSTUDIO_INSTALL_RESOURCES}/ai-providers/node_modules"
)
```

- [ ] **Step 2: Add to parent CMakeLists.txt**

Modify `src/node/CMakeLists.txt` to include ai-providers:

```cmake
# set minimum version
cmake_minimum_required(VERSION 3.6.3)

# don't add electron for development mode (since faster to work
# iteratively using "npm start" and so forth)
if(RSTUDIO_ELECTRON AND NOT RSTUDIO_DEVELOPMENT)
   add_subdirectory(desktop)
endif()

# BYOK AI providers service (built for both Desktop and Server)
add_subdirectory(ai-providers)
```

- [ ] **Step 3: Commit**

```bash
git add src/node/ai-providers/CMakeLists.txt src/node/CMakeLists.txt
git commit -m "Add CMake build integration for BYOK AI providers service"
```

---

## Chunk 8: Testing

### Task 18: Add Node.js unit tests

**Files:**
- Create: `src/node/ai-providers/tests/providers.test.ts`
- Create: `src/node/ai-providers/tests/protocol.test.ts`
- Create: `src/node/ai-providers/tests/completions.test.ts`

- [ ] **Step 1: Write provider mock tests**

Create `src/node/ai-providers/tests/providers.test.ts`:

```typescript
import { describe, it, assert } from "node:test";
import { createProvider } from "../src/providers/base.js";

describe("createProvider", () => {
  it("throws for unknown provider", () => {
    assert.throws(() => createProvider("unknown", "key", "model"), /Unknown provider/);
  });

  it("creates anthropic provider", () => {
    const provider = createProvider("anthropic", "test-key", "claude-sonnet-4");
    assert.ok(provider);
    assert.ok(typeof provider.chat === "function");
    assert.ok(typeof provider.complete === "function");
  });

  it("creates openai provider", () => {
    const provider = createProvider("openai", "test-key", "gpt-4o");
    assert.ok(provider);
  });

  it("creates google-gemini provider", () => {
    const provider = createProvider("google-gemini", "test-key", "gemini-2.5-pro");
    assert.ok(provider);
  });
});
```

- [ ] **Step 2: Write tool translation tests**

Create `src/node/ai-providers/tests/protocol.test.ts`:

```typescript
import { describe, it, assert } from "node:test";
import { translateToolCall, translateToolResult } from "../src/chat/tools.js";

describe("translateToolCall", () => {
  it("translates execute_code", () => {
    const result = translateToolCall({
      id: "tc1",
      name: "execute_code",
      arguments: { language: "r", code: "1 + 1" },
    });
    assert.strictEqual(result.method, "runtime/executeCode");
    assert.strictEqual(result.params.code, "1 + 1");
    assert.ok(result.params.trackingId);
  });

  it("translates read_file with path normalization", () => {
    const result = translateToolCall({
      id: "tc2",
      name: "read_file",
      arguments: { uri: "/home/user/script.R" },
    });
    assert.strictEqual(result.method, "workspace/readFileContent");
    assert.strictEqual(result.params.uri, "file:///home/user/script.R");
  });

  it("throws for unknown tool", () => {
    assert.throws(() => translateToolCall({
      id: "tc3", name: "unknown_tool", arguments: {},
    }), /Unknown tool/);
  });
});

describe("translateToolResult", () => {
  it("translates success result", () => {
    const result = translateToolResult("tc1", { output: "2", error: "" });
    assert.strictEqual(result.toolCallId, "tc1");
    assert.ok(!result.isError);
  });

  it("translates error result", () => {
    const result = translateToolResult("tc1", { error: "syntax error" });
    assert.strictEqual(result.isError, true);
    assert.ok(result.content.includes("syntax error"));
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd src/node/ai-providers && npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/node/ai-providers/tests/
git commit -m "Add unit tests for BYOK providers and protocol translation"
```

### Task 19: Verify full build

- [ ] **Step 1: Build Node.js service**

```bash
cd src/node/ai-providers && npm ci && npm run build
```

Expected: TypeScript compiles to `dist/` without errors.

- [ ] **Step 2: Build GWT frontend**

```bash
cd src/gwt && ant javac
```

Expected: Java compiles with new preference constants and UI changes.

- [ ] **Step 3: Build C++ backend (if build directory exists)**

```bash
cd build && cmake --build . --target all
```

Expected: C++ compiles with new session/server options and RPC handlers.

- [ ] **Step 4: Final commit with any build fixes**

```bash
git add -A
git commit -m "Fix build issues from BYOK integration"
```

---

## Execution Order Summary

| Task | Component | Description | Dependencies |
|------|-----------|-------------|--------------|
| 1-4 | Schema/Config | Preferences, state, options, codegen | None |
| 5 | Node.js | Project scaffold | None |
| 6-7 | Node.js | Provider implementations | Task 5 |
| 8-9 | Node.js | Chat mode (WebSocket) | Tasks 6-7 |
| 10-11 | Node.js | Completions mode (stdio) | Tasks 6-7 |
| 12-13 | C++ | Backend integration | Tasks 1-4 |
| 14-16 | GWT | Frontend changes | Tasks 1-4 |
| 17 | Build | CMake integration | Task 5 |
| 18-19 | Testing | Unit tests + full build | All above |

Tasks 5-11 (Node.js) and Tasks 12-16 (C++/GWT) can be parallelized after Tasks 1-4 complete.
