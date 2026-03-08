import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { assistantRoutes } from "../assistant.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Assistant API routes", () => {
  let app: Hono;
  let manager: MockInstanceManager;
  let llm: LlmClient;
  let db: Database.Database;

  const mockHostStore = {
    list: () => [] as any[],
    getDecryptedCredential: () => "mock-cred",
  };

  function initDb() {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
  }

  function buildApp() {
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/assistant", assistantRoutes(mockHostStore as any, manager as any, llm, db));
  }

  beforeEach(() => {
    manager = new MockInstanceManager();
    llm = new LlmClient();
    mockHostStore.list = () => [];
    initDb();
    buildApp();
  });

  // --- LLM not configured ---

  it("POST /chat returns 400 when LLM not configured", async () => {
    const res = await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("LLM not configured");
  });

  // --- Missing messages ---

  it("POST /chat returns 400 when messages empty", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    buildApp();

    const res = await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("messages required");
  });

  // --- Successful chat ---

  it("POST /chat returns reply from LLM", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "Hello!" },
      tokensUsed: 100,
    });
    buildApp();

    const res = await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe("Hello!");
    expect(data.actions).toEqual([]);
    expect(data.tokensUsed).toBe(100);
  });

  // --- Environment context injection ---

  it("system prompt includes host info", async () => {
    mockHostStore.list = () => [
      { id: 1, label: "Prod Server", host: "10.0.0.1", port: 22, username: "ubuntu", authMethod: "password", credential: "***", created_at: "", last_scan_at: null, last_scan_error: null },
    ];
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m) => m.role === "system")?.content;
    expect(systemMsg).toContain("ssh ubuntu@10.0.0.1 -p 22");
    expect(systemMsg).toContain("Prod Server");
  });

  it("system prompt includes instance info under hosts", async () => {
    mockHostStore.list = () => [
      { id: 1, label: "Prod", host: "10.0.0.1", port: 22, username: "ubuntu", authMethod: "password", credential: "***", created_at: "", last_scan_at: null, last_scan_error: null },
    ];
    manager.seed([
      makeInstanceInfo({
        id: "ssh-1-default",
        connection: { id: "ssh-1-default", url: "ws://10.0.0.1:18789", status: "connected", label: "Default" },
        version: "2026.3.3",
      }),
    ]);
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m) => m.role === "system")?.content;
    expect(systemMsg).toContain("Prod");
    expect(systemMsg).toContain('"Default" [connected]');
    expect(systemMsg).toContain("v2026.3.3");
  });

  it("system prompt includes local instances", async () => {
    manager.seed([
      makeInstanceInfo({
        id: "local-default",
        connection: { id: "local-default", url: "ws://127.0.0.1:18789", status: "connected", label: "Local Dev" },
      }),
    ]);
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m) => m.role === "system")?.content;
    expect(systemMsg).toContain("### Local");
    expect(systemMsg).toContain('"Local Dev" [connected]');
  });

  it("system prompt omits environment section when no hosts/instances", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m) => m.role === "system")?.content;
    expect(systemMsg).not.toContain("Environment Overview");
  });

  // --- Instance context ---

  it("system prompt includes current instance context when instanceId provided", async () => {
    // Use local instance to avoid SshExec creation
    manager.seed([
      makeInstanceInfo({
        id: "local-default",
        connection: { id: "local-default", url: "ws://127.0.0.1:18789", status: "connected", label: "My Instance" },
        version: "2026.3.3",
      }),
    ]);
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    const res = await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        instanceId: "local-default",
      }),
    });
    expect(res.status).toBe(200);

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m: any) => m.role === "system")?.content;
    expect(systemMsg).toContain("## Current Instance Context");
    expect(systemMsg).toContain("Instance ID: local-default");
    expect(systemMsg).toContain("My Instance");
  });

  it("system prompt shows no-instance message when instanceId not provided", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    const systemMsg = chatCall.messages.find((m) => m.role === "system")?.content;
    expect(systemMsg).toContain("No specific instance selected");
  });

  // --- Tool availability ---

  it("only get_docs tool available without instance", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "test-key" });
    vi.spyOn(llm, "chat").mockResolvedValue({
      message: { role: "assistant", content: "ok" },
    });
    buildApp();

    await app.request("/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });

    const chatCall = vi.mocked(llm.chat).mock.calls[0][0];
    expect(chatCall.tools).toHaveLength(1);
    expect(chatCall.tools![0].name).toBe("get_docs");
  });
});
