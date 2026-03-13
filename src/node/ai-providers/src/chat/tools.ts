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
