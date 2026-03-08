import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { digestRoutes } from "../digest.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Digest API routes", () => {
  let app: Hono;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    const manager = new MockInstanceManager();
    manager.seed([makeInstanceInfo()]);
    const llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/digest", digestRoutes(manager as any, llm, db));
  });

  it("POST / returns 400 when LLM not configured", async () => {
    const res = await app.request("/digest", { method: "POST" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("LLM not configured");
  });
});
