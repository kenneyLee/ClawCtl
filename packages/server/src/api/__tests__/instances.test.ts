import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { instanceRoutes } from "../instances.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Instance API routes", () => {
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
    manager.seed([makeInstanceInfo()]);
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/instances", instanceRoutes(manager as any, db));
  });

  it("GET / returns all instances", async () => {
    const res = await app.request("/instances");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("test-1");
  });

  it("POST / creates instance", async () => {
    const res = await app.request("/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ws://example.com:18789", label: "New" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toMatch(/^remote-/);
  });

  it("POST / without url returns 400", async () => {
    const res = await app.request("/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "No URL" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:id removes instance", async () => {
    const res = await app.request("/instances/test-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(manager.get("test-1")).toBeUndefined();
  });

  it("POST /:id/refresh returns updated info", async () => {
    const res = await app.request("/instances/test-1/refresh", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /:id/refresh returns 404 for missing", async () => {
    const res = await app.request("/instances/nonexistent/refresh", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
