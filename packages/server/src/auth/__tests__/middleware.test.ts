import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware, requireRole, requireWrite } from "../middleware.js";
import { createToken } from "../session.js";
import type { SessionPayload } from "../types.js";

const SECRET = "test-middleware-secret";

function makeApp() {
  const app = new Hono();
  app.use("/*", authMiddleware(SECRET));

  app.post("/api/auth/login", (c) => c.json({ ok: true }));
  app.post("/api/auth/setup", (c) => c.json({ ok: true }));
  app.get("/api/auth/status", (c) => c.json({ ok: true }));
  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/instances", (c) => c.json({ user: c.get("user") }));
  app.get("/api/admin-only", requireRole("admin"), (c) => c.json({ ok: true }));
  app.post("/api/write-instances", requireWrite("instances"), (c) => c.json({ ok: true }));
  app.put("/api/write-settings", requireWrite("settings"), (c) => c.json({ ok: true }));

  return app;
}

function tokenFor(payload: SessionPayload) {
  return createToken(payload, SECRET);
}

const admin: SessionPayload = { userId: 1, username: "admin", role: "admin" };
const operator: SessionPayload = { userId: 2, username: "op", role: "operator" };
const auditor: SessionPayload = { userId: 3, username: "aud", role: "auditor" };

describe("authMiddleware", () => {
  const app = makeApp();

  it("allows /api/auth/login without token", async () => {
    const res = await app.request("/api/auth/login", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows /api/auth/setup without token", async () => {
    const res = await app.request("/api/auth/setup", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows /api/auth/status without token", async () => {
    const res = await app.request("/api/auth/status");
    expect(res.status).toBe(200);
  });

  it("allows /api/health without token", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

  it("returns 401 for protected route without token", async () => {
    const res = await app.request("/api/instances");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid token", async () => {
    const res = await app.request("/api/instances", {
      headers: { Authorization: "Bearer invalid.token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid cookie token", async () => {
    const token = tokenFor(admin);
    const res = await app.request("/api/instances", {
      headers: { Cookie: `clawctl_token=${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect((data as any).user.username).toBe("admin");
  });

  it("accepts valid Bearer header token", async () => {
    const token = tokenFor(admin);
    const res = await app.request("/api/instances", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("requireRole", () => {
  const app = makeApp();

  it("admin passes requireRole('admin')", async () => {
    const res = await app.request("/api/admin-only", {
      headers: { Authorization: `Bearer ${tokenFor(admin)}` },
    });
    expect(res.status).toBe(200);
  });

  it("operator fails requireRole('admin') with 403", async () => {
    const res = await app.request("/api/admin-only", {
      headers: { Authorization: `Bearer ${tokenFor(operator)}` },
    });
    expect(res.status).toBe(403);
  });

  it("auditor fails requireRole('admin') with 403", async () => {
    const res = await app.request("/api/admin-only", {
      headers: { Authorization: `Bearer ${tokenFor(auditor)}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("requireWrite", () => {
  const app = makeApp();

  it("admin can write instances", async () => {
    const res = await app.request("/api/write-instances", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFor(admin)}` },
    });
    expect(res.status).toBe(200);
  });

  it("operator can write instances", async () => {
    const res = await app.request("/api/write-instances", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFor(operator)}` },
    });
    expect(res.status).toBe(200);
  });

  it("auditor cannot write instances (403)", async () => {
    const res = await app.request("/api/write-instances", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenFor(auditor)}` },
    });
    expect(res.status).toBe(403);
  });

  it("operator cannot write settings (403)", async () => {
    const res = await app.request("/api/write-settings", {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokenFor(operator)}` },
    });
    expect(res.status).toBe(403);
  });
});
