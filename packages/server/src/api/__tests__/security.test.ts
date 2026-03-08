import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { securityRoutes } from "../security.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Security API routes", () => {
  let app: Hono;
  let manager: MockInstanceManager;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS permission_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      config_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    )`);
    manager = new MockInstanceManager();
    manager.seed([makeInstanceInfo()]);
    const llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/security", securityRoutes(manager as any, db, llm));
  });

  it("GET /:id/security returns audit items", async () => {
    const res = await app.request("/security/test-1/security");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].level).toBe("critical");
  });

  it("GET /:id/security returns 404 for missing", async () => {
    const res = await app.request("/security/nope/security");
    expect(res.status).toBe(404);
  });

  it("GET /overview returns cross-instance summary", async () => {
    const res = await app.request("/security/overview");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].criticalCount).toBe(1);
    expect(data[0].warnCount).toBe(1);
  });
});
