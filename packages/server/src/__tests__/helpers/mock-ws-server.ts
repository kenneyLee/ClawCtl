import { WebSocketServer } from "ws";

export interface MockGateway {
  url: string;
  port: number;
  server: WebSocketServer;
  onRpc: (method: string, handler: (params?: any) => any) => void;
  close: () => Promise<void>;
}

export async function createMockGateway(): Promise<MockGateway> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0 }, () => {
      const port = (server.address() as any).port;
      const handlers = new Map<string, (params?: any) => any>();

      server.on("connection", (ws) => {
        // Send challenge event on connect (like real Gateway)
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "mock-nonce-12345" },
        }));

        ws.on("message", (data) => {
          let msg: any;
          try {
            msg = JSON.parse(data.toString());
          } catch { return; }

          // Only handle "req" frames
          if (msg.type !== "req") return;

          try {
            // Handle connect handshake
            if (msg.method === "connect") {
              ws.send(JSON.stringify({
                type: "res",
                id: msg.id,
                ok: true,
                payload: {
                  type: "hello-ok",
                  protocol: 3,
                  server: { version: "1.0.0-mock", connId: "mock-conn-1" },
                  features: { methods: [], events: [] },
                  snapshot: { presence: [], stateVersion: { presence: 0 } },
                  policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 1000 },
                },
              }));
              return;
            }

            const handler = handlers.get(msg.method);
            if (handler) {
              const result = handler(msg.params);
              ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, payload: result }));
            } else {
              ws.send(JSON.stringify({
                type: "res", id: msg.id, ok: false,
                error: { code: "METHOD_NOT_FOUND", message: `Method not found: ${msg.method}` },
              }));
            }
          } catch (err: any) {
            ws.send(JSON.stringify({
              type: "res", id: msg.id, ok: false,
              error: { code: "HANDLER_ERROR", message: err.message ?? "Handler error" },
            }));
          }
        });
      });

      resolve({
        url: `ws://127.0.0.1:${port}`,
        port,
        server,
        onRpc: (method, handler) => handlers.set(method, handler),
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
