import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { instanceRoutes } from "../api/instances.js";
import { sessionRoutes } from "../api/sessions.js";
import { configRoutes } from "../api/config.js";
import { securityRoutes } from "../api/security.js";
import { toolRoutes } from "../api/tools.js";
import { MockInstanceManager } from "./helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "./helpers/fixtures.js";
import { LlmClient } from "../llm/client.js";
import { mockAuthMiddleware } from "./helpers/mock-auth.js";

describe("Integration: full API app", () => {
  let app: Hono;
  let manager: MockInstanceManager;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    manager = new MockInstanceManager();
    const llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/api/instances", instanceRoutes(manager as any, db));
    app.route("/api/instances", sessionRoutes(manager as any, llm));
    app.route("/api/instances", configRoutes(manager as any));
    db.exec(`CREATE TABLE IF NOT EXISTS permission_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      config_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    )`);
    app.route("/api/instances", securityRoutes(manager as any, db, llm));
    app.route("/api/tools", toolRoutes(manager as any, llm));
  });

  it("add instance then query it", async () => {
    let res = await app.request("/api/instances");
    let data = await res.json();
    expect(data).toHaveLength(0);

    res = await app.request("/api/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ws://localhost:18789", label: "Test" }),
    });
    expect(res.status).toBe(201);

    res = await app.request("/api/instances");
    data = await res.json();
    expect(data).toHaveLength(1);
  });

  it("add instance then get sessions", async () => {
    manager.seed([makeInstanceInfo({ id: "prod" })]);
    const res = await app.request("/api/instances/prod/sessions");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
  });

  it("security overview aggregates across instances", async () => {
    manager.seed([
      makeInstanceInfo({ id: "a", connection: { id: "a", url: "ws://a", status: "connected", label: "A" } }),
      makeInstanceInfo({ id: "b", connection: { id: "b", url: "ws://b", status: "connected", label: "B" } }),
    ]);
    const res = await app.request("/api/instances/overview");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("tool diagnose works through full API", async () => {
    manager.seed([makeInstanceInfo({ id: "prod" })]);
    const res = await app.request("/api/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "prod", agentId: "main", toolName: "exec" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps.length).toBeGreaterThan(0);
  });

  it("config compare between two instances", async () => {
    manager.seed([
      makeInstanceInfo({ id: "a", connection: { id: "a", url: "ws://a", status: "connected", label: "A" } }),
      makeInstanceInfo({ id: "b", connection: { id: "b", url: "ws://b", status: "connected", label: "B" } }),
    ]);
    const res = await app.request("/api/instances/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceA: "a", instanceB: "b" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.a).toBeDefined();
    expect(data.b).toBeDefined();
  });

  it("delete instance then verify gone", async () => {
    manager.seed([makeInstanceInfo({ id: "del-me" })]);
    await app.request("/api/instances/del-me", { method: "DELETE" });
    const res = await app.request("/api/instances");
    const data = await res.json();
    expect((data as any[]).find((d: any) => d.id === "del-me")).toBeUndefined();
  });
});
