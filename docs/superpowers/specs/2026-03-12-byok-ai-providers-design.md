# BYOK AI Providers for RStudio Assistant

**Date:** 2026-03-12
**Status:** Approved

## Overview

Add Bring Your Own Key (BYOK) support to RStudio's AI assistant, allowing users to use their own Anthropic (Claude), OpenAI (GPT), and Google Gemini API keys for chat, inline code completions, and agent tools (file editing, code execution). The existing Posit AI and GitHub Copilot integrations remain unchanged.

## Approach

Build a new Node.js service (`src/node/ai-providers/`) that speaks the same protocols as the existing Posit AI backend:
- **Chat**: PAI WebSocket protocol v10.0 (JSON-RPC 2.0)
- **Completions**: LSP stdio protocol (Content-Length framed JSON-RPC 2.0)

`SessionChat.cpp` and `SessionAssistant.cpp` conditionally launch the BYOK service instead of PAI/Copilot when a BYOK provider is selected. The frontend requires minimal changes since it sees the same protocol regardless of provider.

## 1. Provider Configuration & Preferences

### User Preferences Schema Changes (`user-prefs-schema.json`)

Extend existing enums:
- `chat_provider`: add `"anthropic"`, `"openai"`, `"google-gemini"` (existing: `"none"`, `"posit"`)
- `assistant`: add `"anthropic"`, `"openai"`, `"google-gemini"` (existing: `"none"`, `"posit"`, `"copilot"`)

New preferences in `user-prefs-schema.json` (non-secret, support project-level overrides):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `anthropic_model` | string | `"claude-sonnet-4"` | Curated dropdown + custom entry. Use alias (no date suffix) for auto-updates. |
| `openai_model` | string | `"gpt-4o"` | Curated dropdown + custom entry. Use alias for auto-updates. |
| `google_gemini_model` | string | `"gemini-2.5-pro"` | Curated dropdown + custom entry. Use alias for auto-updates. |
| `openai_api_url` | string | `"https://api.openai.com/v1"` | Base URL for OpenAI-compatible endpoints |
| `anthropic_api_url` | string | `"https://api.anthropic.com"` | Base URL for Anthropic-compatible endpoints |
| `google_gemini_api_url` | string | `""` | Base URL override for Gemini (empty = default) |

New preferences in `user-state-schema.json` (secrets, local-only, never synced):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `anthropic_api_key` | string | `""` | Fallback: `ANTHROPIC_API_KEY` env var |
| `openai_api_key` | string | `""` | Fallback: `OPENAI_API_KEY` env var |
| `google_gemini_api_key` | string | `""` | Fallback: `GOOGLE_API_KEY` or `GEMINI_API_KEY` env var |

### Enum Readable Labels

For `chat_provider` enum, add to `enumReadable`:
- `"anthropic"` → `"Anthropic (Claude)"`
- `"openai"` → `"OpenAI (GPT)"`
- `"google-gemini"` → `"Google Gemini"`

For `assistant` enum, add to `enumReadable`:
- `"anthropic"` → `"Anthropic (Claude)"`
- `"openai"` → `"OpenAI (GPT)"`
- `"google-gemini"` → `"Google Gemini"`

### API Key Resolution Order

1. User preference value
2. Environment variable fallback
3. Empty (provider unavailable)

Keys are stored in `user-state-schema.json` (local-only state, never synced or backed up) rather than `user-prefs-schema.json`, to avoid accidental exposure via preference sync or backup. The state file has user-only file permissions. OS keychain integration (macOS Keychain, libsecret on Linux, Windows Credential Manager) is deferred to a follow-up — the threat model for v1 assumes the user's home directory is private, consistent with how SSH keys and `.Renviron` secrets are handled today. On RStudio Server, admins concerned about key storage should direct users to use environment variables instead.

### Admin Controls

- **Server option** `--allow-byok-providers` in `server-options.json` (bool, default: `true`): Enforced at the server level in `rserver.conf`, cannot be overridden by users. When disabled, BYOK provider options are hidden from the preferences UI and BYOK processes cannot be launched.
- **Session option** `--allow-byok-providers` in `session-options.json` (bool, default: `true`): For Desktop and single-user deployments. The server option takes precedence when both are set.

## 2. Node.js BYOK Service

### Node.js Runtime Discovery

The BYOK service requires Node.js >= 18.0. It reuses the existing `node_tools::findNode()` infrastructure (in `SessionNodeTools.cpp`) which already handles platform-specific concerns like arm64 Mac binary discovery and is used by PAI and Copilot.

Extensions to `findNode()` for BYOK:

1. **`--byok-node-path` session option**: If set, takes priority as the Node.js binary for BYOK processes. This allows admins to use a different Node.js than the one used for PAI/Copilot.
2. **Version validation**: After resolving the Node.js path, check `node --version` >= 18.0. If below minimum, BYOK is unavailable and the preferences UI shows: "Node.js >= 18 required for BYOK providers. Install Node.js or use Posit AI."
3. **RStudio Server fallback**: If `findNode()` returns no result (no bundled or system Node.js), BYOK is marked unavailable at session init. The `chat_provider` and `assistant` dropdowns disable the BYOK options with a tooltip explaining the requirement.

The path to `ai-providers/dist/main.js` is resolved relative to RStudio's resource directory (`kResourcesPath / "ai-providers"`), set at build time and consistent across platforms.

### Location

`src/node/ai-providers/`

### Directory Structure

```
src/node/ai-providers/
├── package.json              # @anthropic-ai/sdk, openai, @google/generative-ai
├── tsconfig.json
├── src/
│   ├── main.ts               # Entry point, arg parsing, mode selection
│   ├── chat/
│   │   ├── server.ts          # WebSocket server, auth token validation
│   │   ├── protocol.ts        # JSON-RPC message handling, capability negotiation
│   │   ├── tools.ts           # Tool definitions mapped to PAI capabilities
│   │   └── conversation.ts    # Conversation state, message history
│   ├── completions/
│   │   ├── agent.ts           # Content-Length framed stdio handler
│   │   ├── inline.ts          # textDocument/inlineCompletion handler
│   │   └── nes.ts             # textDocument/copilotInlineEdit handler
│   ├── providers/
│   │   ├── base.ts            # Common AIProvider interface
│   │   ├── anthropic.ts       # Anthropic Claude SDK wrapper
│   │   ├── openai.ts          # OpenAI SDK wrapper
│   │   └── google-gemini.ts   # Google Gemini SDK wrapper
│   └── util/
│       ├── streaming.ts       # Stream buffering/flushing
│       └── prompts.ts         # System prompts for completions
└── dist/                      # Compiled output
```

### Two Modes of Operation

**Chat mode** (`--mode chat --port <port> --provider <name> --model <id>`):
- Starts WebSocket server on given port
- Speaks PAI protocol v10.0
- Handles `protocol/getVersion` handshake with same capabilities
- Translates tool calls between PAI protocol and provider tool_use format
- Auth token from `RSTUDIO_CHAT_AUTH_TOKEN` env var
- API key from `RSTUDIO_BYOK_API_KEY` env var

**Completions mode** (`--mode completions --provider <name> --model <id>`):
- JSON-RPC 2.0 over stdio with Content-Length framing
- Handles `textDocument/inlineCompletion` and `textDocument/copilotInlineEdit`
- Builds FIM-style prompt from document context
- API key from `RSTUDIO_BYOK_API_KEY` env var

### Provider Interface

```typescript
interface AIProvider {
  chat(
    messages: Message[],
    tools: Tool[],
    onChunk: (chunk: string) => void
  ): Promise<ChatResponse>;

  complete(
    prefix: string,
    suffix: string,
    language: string,
    variables: Variable[]
  ): Promise<string>;
}
```

Each provider wraps the official SDK and normalizes tool call formats.

### Context Window Management

Each provider has different context limits (Claude: 200K, GPT-4o: 128K, Gemini: 1M). The BYOK service manages this per-provider:

- **Token counting**: Use each SDK's tokenizer (or tiktoken for OpenAI, Anthropic's token counting API, Gemini's `countTokens`) to track conversation size.
- **Truncation strategy**: When conversation approaches 80% of the model's context window, older messages (excluding the system prompt and most recent 4 turns) are dropped with a summary message: "[Earlier conversation truncated — N messages removed]".
- **Cost awareness**: The service tracks input/output token counts per request and surfaces them via a `chat/tokenUsage` notification to the frontend, displayed as a subtle indicator in the chat pane (e.g., "~1.2K tokens used this turn").

### Error Handling

Provider API errors are mapped to user-friendly messages:

| HTTP Status | Meaning | User-Facing Message |
|---|---|---|
| 401 | Invalid/expired key | "API key is invalid or expired. Check your key in Preferences > Assistant." |
| 403 | Forbidden | "Access denied. Your API key may not have access to this model." |
| 429 | Rate limited | "Rate limit reached. Waiting {retry_after}s before retrying..." (auto-retry with backoff, max 3 retries) |
| 5xx | Server error | "The {provider} API is temporarily unavailable. Try again in a moment." |
| Network error | DNS/TLS/timeout | "Cannot reach {provider} API. Check your network connection and proxy settings." |

For 429 errors: exponential backoff (2s, 4s, 8s) with up to 3 retries. For all other errors: no retry, surface immediately. Mid-conversation errors (e.g., 401 after a few turns) show an inline error in the chat pane with a "Retry" button.

The "Test Connection" button sends a minimal request (e.g., a single-token completion) to verify both the API key and the specified model are valid.

## 3. Backend Integration (C++)

### SessionChat.cpp

Modify `chatStartBackend()` to branch on `chat_provider`:

- `"posit"` → launch PAI process (existing, unchanged)
- `"anthropic"` | `"openai"` | `"google-gemini"` → launch BYOK service in chat mode

The BYOK service is launched as:
```
node ai-providers/dist/main.js --mode chat --port <port> --provider <name> --model <id>
```

With environment variables:
- `RSTUDIO_CHAT_AUTH_TOKEN` — per-session WebSocket auth token
- `RSTUDIO_BYOK_API_KEY` — resolved API key
- `NODE_EXTRA_CA_CERTS` — custom SSL certificates (if configured)
- `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` — passthrough from session environment for enterprise proxy support

Other chat RPCs (`chatGetBackendUrl`, `chatStopBackend`, `chatGetBackendStatus`) work unchanged since the BYOK service binds to the same URL format.

Version/update RPCs return early with "not applicable" for BYOK providers.

### SessionAssistant.cpp

Modify `startAgent()` to branch on `assistant`:

- `"copilot"` → launch Copilot agent (existing, unchanged)
- `"posit"` → launch PAI agent (existing, unchanged)
- `"anthropic"` | `"openai"` | `"google-gemini"` → launch BYOK service in completions mode

The BYOK completions agent is launched as:
```
node ai-providers/dist/main.js --mode completions --provider <name> --model <id>
```

Over stdio, same as existing agents. The rest of the completions pipeline (document sync, request/response handling, timeout/cancellation) stays the same.

Sign-in/sign-out RPCs return "not applicable" for BYOK providers.

## 4. Frontend Changes (GWT)

### Preferences UI (`AssistantPreferencesPane.java`)

- Add Anthropic, OpenAI, Google Gemini to both dropdowns
- Conditional API key fields: shown when a BYOK provider is selected
  - Password-masked text field with hint text (e.g., "Uses $ANTHROPIC_API_KEY if empty")
  - Model selector: combobox with curated defaults + editable for custom model IDs
  - OpenAI only: Base URL field
- "Test Connection" button: minimal API call to verify key works

### PaiUtil.java

- Generalize `isChatProviderPosit()` to `getChatProviderType()` enum
- Add `isChatProviderByok()` helper
- Existing project-level override logic applies to new providers

### ChatPresenter.java

- Hide installation/update UI for BYOK providers
- Provider-specific error messages (e.g., "Invalid API key" vs "Posit AI not installed")
- Display provider name in chat pane header ("Claude (Anthropic)" / "GPT (OpenAI)" / "Gemini (Google)")

### AssistantPreferencesPane.java (assistant status section)

- Hide sign-in/sign-out UI for BYOK providers
- Show "API key configured" status
- Restart agent process on provider switch

### New Constants

Add to `UserPrefsAccessor`:
- `CHAT_PROVIDER_ANTHROPIC`, `CHAT_PROVIDER_OPENAI`, `CHAT_PROVIDER_GOOGLE_GEMINI`
- `ASSISTANT_ANTHROPIC`, `ASSISTANT_OPENAI`, `ASSISTANT_GOOGLE_GEMINI`

## 5. Tool Call Translation

### PAI Capabilities Mapped to Provider Tools

| PAI Method | Provider Tool Name | Parameters |
|---|---|---|
| `runtime/executeCode` | `execute_code` | `language`, `code` |
| `workspace/readFileContent` | `read_file` | `uri` |
| `workspace/writeFileContent` | `write_file` | `uri`, `content` |
| `workspace/editFileContent` | `edit_file` | `uri`, `startRow`, `startColumn`, `endRow`, `endColumn`, `newText` |
| `workspace/insertIntoNewFile` | `create_file` | `content`, `type` |
| `workspace/insertAtCursor` | `insert_at_cursor` | `content` |
| `ui/openDocument` | `open_document` | `path` |
| `runtime/getDetailedContext` | `get_context` | (none) |
| `runtime/getConsoleContent` | `get_console` | `limit` |

### Translation Flow (per chat turn)

1. User message received via WebSocket
2. Build provider API request: system prompt + history + tool definitions + user message
3. Provider responds with text and/or tool calls
4. For each tool call: translate to PAI JSON-RPC request → send to RStudio → get result → translate back to provider tool result format
5. Continue conversation with tool results until final text response
6. Stream text chunks back through WebSocket

### Provider Tool Format Mapping

- **Anthropic**: `tool_use` content blocks → `tool_result` content blocks
- **OpenAI**: `tool_calls` array → `tool` role messages
- **Gemini**: `functionCall` parts → `functionResponse` parts

## 6. Completions Translation

### Quality and Limitations

Chat-based models are not optimized for fill-in-the-middle (FIM) completions the way dedicated completion models (Copilot, Codex) are. BYOK completions will be noticeably slower and sometimes lower quality. This is a known tradeoff that should be clearly communicated:

- The preferences UI shows a note: "Dedicated completion providers (Copilot, Posit AI) offer faster and more accurate inline suggestions. BYOK completions use chat models and may be slower."
- Users can mix providers: e.g., Copilot for completions + Anthropic for chat.

### Inline Completions (`textDocument/inlineCompletion`)

1. Receive LSP request with document URI, cursor position, variables
2. Retrieve document content from tracked `didOpen`/`didChange` state
3. Split at cursor into prefix and suffix
4. Build chat completion request with a tightly constrained prompt:

```
System: "Output ONLY code to insert. No markdown, no explanation, no backticks.
Language: {languageId}. Match the existing style exactly."

User: "[PREFIX]{prefix}[CURSOR]{suffix}[SUFFIX]

Variables: {variable summaries}"
```

5. Send to provider (non-streaming, max_tokens adaptive: 50 for single-line context, 200 for multi-line)
6. Post-process: strip markdown fences if present, trim leading/trailing whitespace, validate syntax bracket balance
7. Return as LSP `InlineCompletionItem`, or empty if post-processing produces invalid output

### Next Edit Suggestions (`textDocument/copilotInlineEdit`)

Same flow with adjusted prompt asking for structured edit suggestion (startRow, startColumn, endRow, endColumn, newText) as JSON. Response parsed with fallback: if JSON parsing fails, return empty suggestion rather than corrupted edits.

### Performance Mitigations

- Debounce via RStudio's `assistant_completions_delay` (recommend 800ms+ for BYOK vs 300ms default)
- Request cancellation on new keystrokes (existing SessionAssistant.cpp behavior)
- Adaptive max_tokens (50-200 based on context)
- Anthropic prompt caching for repeated requests with same file prefix
- 5-second hard timeout, return empty if exceeded
- Provider-specific: use `temperature: 0` for deterministic completions

## 7. Build Integration

- Add `src/node/ai-providers/` to CMake build via a new `CMakeLists.txt` in that directory
- Built unconditionally for both Desktop and Server configurations (unlike `src/node/desktop/` which is Desktop-only)
- Build steps: `npm ci --production` + `npm run build` (TypeScript compilation)
- Compiled `dist/` installed to `${RSTUDIO_RESOURCES_DIR}/ai-providers/`
- No separate installation or update mechanism (ships with RStudio)

## 8. Security

- **Key storage**: Stored in `user-state-schema.json` (local-only, never synced). User-only file permissions. OS keychain deferred to v2.
- **Key transmission**: Via environment variable to Node.js process (not CLI args visible in `ps`)
- **File access guardrails**: Existing `SessionChat.R` restrictions apply — BYOK service goes through RStudio's tool handlers
- **Admin controls**: Server-level `--allow-byok-providers false` in `rserver.conf` hides all BYOK options and cannot be overridden by users
- **No data to Posit**: BYOK traffic goes directly to the provider's API
- **Proxy support**: `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` passed through to Node.js process. All three provider SDKs respect these variables.
- **Logging**: The BYOK service logs to a file at `{session-log-dir}/byok-ai.log`. Log levels configurable via `--log-level` flag. API keys are never logged. Request/response bodies are only logged at `trace` level.

## 9. Testing

### Unit Tests (Node.js)
- Provider wrappers: mock SDK responses, verify API call format
- Protocol translation: PAI messages ↔ provider tool calls
- Completions: FIM prompt construction and response parsing
- Stdio framing: Content-Length encoding/decoding

### Integration Tests (C++ / BRAT)
- Provider switching: change pref, verify correct process launched
- API key resolution: preference → env var fallback
- Process lifecycle: start/stop/restart
- Error handling: invalid key, network failure, rate limiting

### Manual Testing Matrix

| Scenario | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| Chat: basic conversation | | | |
| Chat: tool use (read file) | | | |
| Chat: tool use (edit file) | | | |
| Chat: tool use (execute code) | | | |
| Chat: streaming response | | | |
| Chat: cancel mid-stream | | | |
| Completions: inline suggestion | | | |
| Completions: NES | | | |
| Completions: cancel on keystroke | | | |
| Prefs: API key from UI | | | |
| Prefs: API key from env var | | | |
| Prefs: custom model ID | | | |
| Prefs: provider switching | | | |
| Admin: --allow-byok-providers false | | | |

## 10. Process Lifecycle

The BYOK Node.js process is managed by the same `ProcessSupervisor` infrastructure used for PAI and Copilot. On session exit (normal logout, crash, or SIGTERM), the session teardown logic sends SIGTERM to the BYOK process, matching existing PAI behavior. The `lifecycle/requestShutdown` notification is sent with a grace period before force kill.

## 11. Known Limitations (v1)

- **OS keychain integration deferred** to v2 — API keys stored in local file only
- **`chat/tokenUsage` notification** is a BYOK-only protocol extension (PAI never sends it). The frontend ignores unknown notifications gracefully, so this is backwards-compatible. Payload: `{ inputTokens: number, outputTokens: number, estimatedCost: string }`
- **"Test Connection" button** invokes a new RPC `byok_test_connection(provider, apiKey, model, apiUrl)` handled in `SessionChat.cpp`. The C++ backend makes a direct HTTPS request to the provider's API (no BYOK Node.js process needed), validating both the key and model access.
- **Build failure resilience**: The `ai-providers` CMake target is optional (`add_custom_target` with `EXCLUDE_FROM_ALL` by default on Server builds where Node.js may not be available). If the build fails, BYOK is simply unavailable at runtime.

## Scope Summary

- **Preferences**: 6 new prefs in `user-prefs-schema.json` (models, URLs), 3 new prefs in `user-state-schema.json` (API keys), extended enums for 2 existing prefs
- **Node.js service**: ~15 source files in `src/node/ai-providers/`
- **C++ backend**: modifications to `SessionChat.cpp`, `SessionAssistant.cpp`, `SessionNodeTools.cpp`, server options, session options
- **GWT frontend**: modifications to `AssistantPreferencesPane.java`, `PaiUtil.java`, `ChatPresenter.java`, plus new constants
- **Build**: new CMakeLists.txt for ai-providers, built for both Desktop and Server
- **No changes** to existing PAI or Copilot code paths
