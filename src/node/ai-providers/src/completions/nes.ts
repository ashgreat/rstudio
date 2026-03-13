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
  prefixLines.push((lines[cursorLine] || "").slice(0, cursorChar));
  const prefix = prefixLines.join("\n");

  const suffixLines = [(lines[cursorLine] || "").slice(cursorChar)];
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
