import { createProvider } from "./providers/base.js";
import { startChatServer } from "./chat/server.js";
import { startCompletionsAgent } from "./completions/agent.js";

async function main(): Promise<void> {
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
