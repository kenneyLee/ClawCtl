import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const MOCK_INSTANCES = [
  {
    id: "inst-1",
    connection: { id: "inst-1", url: "ws://localhost:18789", label: "Lark", status: "connected" },
    health: { status: "ok" },
    agents: [
      { id: "main", name: "main", model: "gpt-4o", toolsAllow: ["exec", "search"], isDefault: true },
      { id: "bhpc", name: "bhpc", model: "gpt-4o", toolsAllow: ["search"] },
    ],
    channels: [{ type: "feishu", enabled: true, running: true, configured: true }],
    sessions: [
      { key: "session-1", kind: "direct", model: "gpt-4o", displayName: "session-1", totalTokens: 1000, inputTokens: 600, outputTokens: 400, updatedAt: Date.now() - 7200_000 },
    ],
    skills: [
      { name: "web-search", status: "ready" },
      { name: "code-review", status: "missing" },
    ],
    config: { gateway: { port: 18789 }, model: { primary: "gpt-4o" } },
    securityAudit: [
      { level: "critical", title: "Open group policy", detail: "Groups have full access" },
      { level: "warn", title: "Elevated tools", detail: "exec enabled" },
    ],
  },
  {
    id: "inst-2",
    connection: { id: "inst-2", url: "ws://localhost:18989", label: "Feishu", status: "connected" },
    health: { status: "ok" },
    agents: [{ id: "main", name: "main", model: "gpt-5.2", toolsAllow: ["search"], isDefault: true }],
    channels: [{ type: "feishu", enabled: true, running: true, configured: true }],
    sessions: [],
    skills: [{ name: "web-search", status: "ready" }],
    config: { gateway: { port: 18989 }, model: { primary: "gpt-5.2" } },
    securityAudit: [],
  },
];

export const handlers = [
  http.get("/api/auth/status", () => HttpResponse.json({ needsSetup: false })),
  http.get("/api/auth/me", () => HttpResponse.json({ userId: 1, username: "admin", role: "admin" })),
  http.post("/api/auth/login", async ({ request }) => {
    const body = await request.json() as any;
    if (body.username === "admin" && body.password === "admin123") {
      return HttpResponse.json({ user: { userId: 1, username: "admin", role: "admin" }, token: "mock-token" });
    }
    return HttpResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }),
  http.post("/api/auth/setup", async ({ request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({ user: { userId: 1, username: body.username, role: "admin" }, token: "mock-token" });
  }),
  http.post("/api/auth/logout", () => HttpResponse.json({ ok: true })),
  http.get("/api/auth/users", () => HttpResponse.json([
    { id: 1, username: "admin", role: "admin", created_at: "2026-03-07T00:00:00Z", last_login: "2026-03-07T12:00:00Z" },
  ])),
  http.get("/api/instances", () => HttpResponse.json(MOCK_INSTANCES)),
  http.post("/api/instances", async () => {
    return HttpResponse.json({ id: `remote-${Date.now()}` }, { status: 201 });
  }),
  http.delete("/api/instances/:id", () => HttpResponse.json({ ok: true })),
  http.post("/api/instances/:id/refresh", ({ params }) => {
    const inst = MOCK_INSTANCES.find((i) => i.id === params.id);
    return inst ? HttpResponse.json(inst) : HttpResponse.json({ error: "not found" }, { status: 404 });
  }),
  http.get("/api/instances/:id/sessions", ({ params }) => {
    const inst = MOCK_INSTANCES.find((i) => i.id === params.id);
    return inst ? HttpResponse.json(inst.sessions) : HttpResponse.json({ error: "not found" }, { status: 404 });
  }),
  http.get("/api/instances/:id/sessions/:key", () =>
    HttpResponse.json([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there! How can I help?" },
    ])
  ),
  http.post("/api/instances/:id/sessions/:key/summarize", () =>
    HttpResponse.json({ error: "LLM not configured" }, { status: 400 })
  ),
  http.get("/api/instances/:id/config", ({ params }) => {
    const inst = MOCK_INSTANCES.find((i) => i.id === params.id);
    return inst ? HttpResponse.json(inst.config) : HttpResponse.json({ error: "not found" }, { status: 404 });
  }),
  http.get("/api/instances/:id/security", ({ params }) => {
    const inst = MOCK_INSTANCES.find((i) => i.id === params.id);
    return inst ? HttpResponse.json(inst.securityAudit) : HttpResponse.json({ error: "not found" }, { status: 404 });
  }),
  http.get("/api/tools/matrix", () =>
    HttpResponse.json(MOCK_INSTANCES.map((inst) => ({
      instanceId: inst.id, label: inst.connection.label,
      agents: inst.agents.map((a) => ({ agentId: a.id, toolsAllow: a.toolsAllow || [] })),
    })))
  ),
  http.post("/api/tools/diagnose", async ({ request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({
      steps: [
        { check: "Agent exists", pass: true, detail: `Agent "${body.agentId}" found` },
        { check: "Tool in tools.allow", pass: false, detail: `"${body.toolName}" is NOT in tools.allow` },
      ],
    });
  }),
  http.get("/api/settings", () => HttpResponse.json({})),
  http.put("/api/settings", () => HttpResponse.json({ ok: true })),
  http.get("/api/operations", () => HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 50 })),
  http.post("/api/digest", () =>
    HttpResponse.json({ error: "LLM not configured" }, { status: 400 })
  ),
];

export const server = setupServer(...handlers);
