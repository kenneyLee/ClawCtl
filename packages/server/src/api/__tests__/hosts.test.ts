import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { hostRoutes } from "../hosts.js";
import { HostStore } from "../../hosts/store.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Hosts API routes", () => {
  let app: Hono;
  let hostStore: HostStore;

  beforeEach(() => {
    const db = new Database(":memory:");
    hostStore = new HostStore(db, "test-secret");
    hostStore.init();
    const manager = new MockInstanceManager();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    app.route("/hosts", hostRoutes(hostStore, manager as any, db));
  });

  it("GET / returns empty list initially", async () => {
    const res = await app.request("/hosts");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(0);
  });

  it("POST / creates a host", async () => {
    const res = await app.request("/hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.1", username: "ubuntu", credential: "pass123", label: "Prod" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.label).toBe("Prod");
    expect(data.credential).toBe("***");
  });

  it("POST / without required fields returns 400", async () => {
    const res = await app.request("/hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.1" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:id removes host", async () => {
    hostStore.create({ label: "del", host: "1.1.1.1", username: "u", authMethod: "password", credential: "p" });
    const hosts = hostStore.list();
    const res = await app.request(`/hosts/${hosts[0].id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(hostStore.list()).toHaveLength(0);
  });

  it("DELETE /:id returns 404 for missing", async () => {
    const res = await app.request("/hosts/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("non-admin gets 403", async () => {
    const app2 = new Hono();
    app2.use("/*", mockAuthMiddleware({ userId: 2, username: "viewer", role: "auditor" }));
    const db2 = new Database(":memory:");
    const store2 = new HostStore(db2, "s");
    store2.init();
    db2.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    app2.route("/hosts", hostRoutes(store2, new MockInstanceManager() as any, db2));
    const res = await app2.request("/hosts");
    expect(res.status).toBe(403);
  });
});
