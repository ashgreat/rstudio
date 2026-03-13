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
