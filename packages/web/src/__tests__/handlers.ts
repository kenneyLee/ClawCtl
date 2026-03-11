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
  http.get("/api/skills", () =>
    HttpResponse.json({
      bundled: [
        { name: "github", description: "GitHub operations", source: "bundled", emoji: "\uD83D\uDC19", category: "dev", tags: ["github"] },
        { name: "notion", description: "Notion API", source: "bundled", emoji: "\uD83D\uDCDD", category: "productivity", tags: ["notion"] },
      ],
      tags: ["github", "notion"],
      categories: ["dev", "productivity"],
    })
  ),
  http.get("/api/skills/templates", () =>
    HttpResponse.json({
      templates: [
        { id: "engineering", name: "Engineering", name_zh: "\u5DE5\u7A0B\u5F00\u53D1", description: "Dev tools", description_zh: "\u5F00\u53D1\u5DE5\u5177", icon: "wrench", skills: [{ name: "github", source: "bundled", note: "PR/Issue/CI" }], builtin: 1, sort_order: 1 },
      ],
    })
  ),
  http.post("/api/skills/install", () => HttpResponse.json({ ok: true })),

  // Lifecycle / LLM providers
  http.get("/api/lifecycle/:id/providers", () =>
    HttpResponse.json({
      providers: {
        openai: { baseUrl: "https://api.openai.com/v1", models: [] },
        anthropic: { baseUrl: "https://api.anthropic.com/v1", models: [] },
      },
      detectedProviders: [],
    })
  ),
  http.put("/api/lifecycle/:id/providers", () =>
    HttpResponse.json({ ok: true })
  ),
  http.get("/api/lifecycle/:id/quota", () =>
    HttpResponse.json({ quotas: [] })
  ),
  http.get("/api/lifecycle/:id/cost-estimate", () =>
    HttpResponse.json({ totalCost: 0, byModel: {}, matched: 0, unmatched: 0 })
  ),

  // Key management handlers
  http.get("/api/lifecycle/:id/keys", () =>
    HttpResponse.json({
      keys: [
        { profileId: "openai:default", provider: "openai", type: "api_key", keyMasked: "sk-t...1234", status: "valid", checkedAt: new Date(Date.now() - 120_000).toISOString(), errorMessage: null, email: "kris@example.com", expiresAt: null },
        { profileId: "openai:key2", provider: "openai", type: "api_key", keyMasked: "sk-n...5678", status: "invalid", checkedAt: new Date(Date.now() - 3600_000).toISOString(), errorMessage: "HTTP 401: unauthorized", email: null, expiresAt: null },
        { profileId: "anthropic:default", provider: "anthropic", type: "api_key", keyMasked: "sk-a...abcd", status: "valid", checkedAt: new Date(Date.now() - 300_000).toISOString(), errorMessage: null, email: "team@company.com", expiresAt: null },
      ],
    })
  ),
  http.post("/api/lifecycle/:id/keys/refresh", () =>
    HttpResponse.json({ refreshing: 0 })
  ),
  http.post("/api/lifecycle/:id/keys/:profileId/verify", () =>
    HttpResponse.json({ profileId: "openai:default", status: "valid", email: "kris@example.com" })
  ),
  http.delete("/api/lifecycle/:id/keys/:profileId", () =>
    HttpResponse.json({ ok: true })
  ),
];

export const server = setupServer(...handlers);
