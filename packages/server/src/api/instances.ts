import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { InstanceManager } from "../instances/manager.js";
import { requireWrite } from "../auth/middleware.js";
import { auditLog } from "../audit.js";

export function instanceRoutes(manager: InstanceManager, db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json(manager.getAll());
  });

  app.post("/", requireWrite("instances"), async (c) => {
    const body = await c.req.json<{ url: string; token?: string; label?: string }>();
    if (!body.url) return c.json({ error: "url is required" }, 400);
    const id = `remote-${Date.now()}`;
    manager.addInstance({
      id,
      url: body.url,
      token: body.token,
      label: body.label,
      status: "disconnected",
    });
    auditLog(db, c, "instance.add", `Added instance: ${body.label || body.url}`, id);
    return c.json({ id }, 201);
  });

  app.delete("/:id", requireWrite("instances"), (c) => {
    const id = c.req.param("id");
    manager.removeInstance(id);
    auditLog(db, c, "instance.delete", `Removed instance: ${id}`, id);
    return c.json({ ok: true });
  });

  app.post("/:id/refresh", async (c) => {
    const id = c.req.param("id");
    const info = await manager.refreshInstance(id);
    if (!info) return c.json({ error: "instance not found or not connected" }, 404);
    return c.json(info);
  });

  return app;
}
