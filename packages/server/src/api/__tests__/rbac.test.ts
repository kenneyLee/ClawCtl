import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { authMiddleware } from "../../auth/middleware.js";
import { createToken } from "../../auth/session.js";
import { instanceRoutes } from "../instances.js";
import { settingsRoutes } from "../settings.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { LlmClient } from "../../llm/client.js";
import type { SessionPayload } from "../../auth/types.js";

const SECRET = "test-rbac-secret";

function tokenFor(p: SessionPayload) {
  return createToken(p, SECRET);
}

const adminToken = tokenFor({ userId: 1, username: "admin", role: "admin" });
const operatorToken = tokenFor({ userId: 2, username: "op", role: "operator" });
const auditorToken = tokenFor({ userId: 3, username: "aud", role: "auditor" });

describe("RBAC integration", () => {
  let app: Hono;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    const manager = new MockInstanceManager();
    const llm = new LlmClient();

    app = new Hono();
    app.use("/api/*", authMiddleware(SECRET));
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    app.route("/api/instances", instanceRoutes(manager as any, db));
    app.route("/api/settings", settingsRoutes(db, llm));
  });

  const postInstance = (token: string) =>
    app.request("/api/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: "ws://localhost:18789", label: "Test" }),
    });

  it("admin can POST /instances (201)", async () => {
    const res = await postInstance(adminToken);
    expect(res.status).toBe(201);
  });

  it("operator can POST /instances (201)", async () => {
    const res = await postInstance(operatorToken);
    expect(res.status).toBe(201);
  });

  it("auditor cannot POST /instances (403)", async () => {
    const res = await postInstance(auditorToken);
    expect(res.status).toBe(403);
  });

  it("admin can PUT /settings", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4" } }),
    });
    expect(res.status).toBe(200);
  });

  it("operator cannot PUT /settings (403)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${operatorToken}` },
      body: JSON.stringify({ llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4" } }),
    });
    expect(res.status).toBe(403);
  });

  it("auditor can GET /instances (read allowed for all)", async () => {
    const res = await app.request("/api/instances", {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    expect(res.status).toBe(200);
  });
});
