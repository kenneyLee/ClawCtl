import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { authRoutes } from "../auth.js";
import { UserStore } from "../../auth/store.js";
import { authMiddleware } from "../../auth/middleware.js";
import { createToken } from "../../auth/session.js";

const SECRET = "test-auth-api-secret";

describe("Auth API routes", () => {
  let app: Hono;
  let userStore: UserStore;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    userStore = new UserStore(db);
    userStore.init();

    app = new Hono();
    app.use("/api/*", authMiddleware(SECRET));
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    app.route("/api/auth", authRoutes(userStore, SECRET, db));
  });

  it("GET /status returns needsSetup=true when no users", async () => {
    const res = await app.request("/api/auth/status");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.needsSetup).toBe(true);
  });

  it("POST /setup creates first admin", async () => {
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user.username).toBe("admin");
    expect(data.user.role).toBe("admin");
    expect(data.token).toBeDefined();
  });

  it("POST /setup returns 400 when users already exist", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin2", password: "admin123" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /setup returns 400 without username/password", async () => {
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /setup returns 400 for short password", async () => {
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /login with correct credentials returns user + token", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.user.username).toBe("admin");
    expect(data.token).toBeDefined();
  });

  it("POST /login with wrong credentials returns 401", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /login without fields returns 400", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /logout returns ok", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /me with valid token returns user info", async () => {
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.username).toBe("admin");
  });

  it("GET /me without token returns 401", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /users as admin returns user list", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveLength(1);
  });

  it("GET /users as operator returns 403", async () => {
    const token = createToken({ userId: 2, username: "op", role: "operator" }, SECRET);
    const res = await app.request("/api/auth/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("POST /users as admin creates user", async () => {
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: "newuser", password: "pass123456", role: "operator" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /users with duplicate username returns 409", async () => {
    userStore.createUser("alice", "pass123456", "operator");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: "alice", password: "pass123456", role: "operator" }),
    });
    expect(res.status).toBe(409);
  });

  it("POST /users with invalid role returns 400", async () => {
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: "bob", password: "pass123456", role: "superadmin" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /users/:id as admin updates role", async () => {
    const user = userStore.createUser("alice", "pass123456", "operator");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request(`/api/auth/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: "auditor" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /users/:id as admin deletes user", async () => {
    // Create admin first (id=1), then alice (id=2), so admin deleting alice != self-delete
    userStore.createUser("admin", "admin123", "admin");
    const user = userStore.createUser("alice", "pass123456", "operator");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request(`/api/auth/users/${user.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /users/:id cannot delete self", async () => {
    userStore.createUser("admin", "admin123", "admin");
    const token = createToken({ userId: 1, username: "admin", role: "admin" }, SECRET);
    const res = await app.request("/api/auth/users/1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});
