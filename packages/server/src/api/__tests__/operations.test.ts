import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { operationRoutes } from "../operations.js";

describe("Operations API routes", () => {
  let app: Hono;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT, type TEXT NOT NULL, status TEXT DEFAULT 'running',
        output TEXT DEFAULT '', operator TEXT,
        started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
      )
    `);
    app = new Hono();
    app.route("/operations", operationRoutes(db));
  });

  it("GET / returns paginated result with empty data", async () => {
    const res = await app.request("/operations");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("GET / returns operations after insert", async () => {
    db.prepare("INSERT INTO operations (instance_id, type) VALUES (?, ?)").run("i1", "diagnose");
    const res = await app.request("/operations");
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("GET / supports pagination", async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO operations (instance_id, type) VALUES (?, ?)").run("i1", `op-${i}`);
    }
    const res = await app.request("/operations?page=2&pageSize=2");
    const body = await res.json() as any;
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
  });

  it("GET / filters by operator", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, operator) VALUES (?, ?, ?)").run("i1", "stop", "admin (admin)");
    db.prepare("INSERT INTO operations (instance_id, type, operator) VALUES (?, ?, ?)").run("i1", "start", "bob (operator)");
    const res = await app.request("/operations?operator=bob");
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].operator).toBe("bob (operator)");
    expect(body.total).toBe(1);
  });

  it("GET / filters by time range", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, started_at) VALUES (?, ?, ?)").run("i1", "old", "2026-01-01 00:00:00");
    db.prepare("INSERT INTO operations (instance_id, type, started_at) VALUES (?, ?, ?)").run("i1", "new", "2026-03-07 12:00:00");
    const res = await app.request("/operations?from=2026-03-01&to=2026-03-08");
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe("new");
    expect(body.total).toBe(1);
  });

  it("GET /:id/stream returns 404 for missing", async () => {
    const res = await app.request("/operations/999/stream");
    expect(res.status).toBe(404);
  });
});
