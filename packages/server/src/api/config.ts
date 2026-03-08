import { Hono } from "hono";
import type { InstanceManager } from "../instances/manager.js";

export function configRoutes(manager: InstanceManager) {
  const app = new Hono();

  app.get("/:id/config", (c) => {
    const info = manager.get(c.req.param("id"));
    if (!info) return c.json({ error: "instance not found" }, 404);
    return c.json(info.config || {});
  });

  app.post("/compare", async (c) => {
    const { instanceA, instanceB } = await c.req.json<{ instanceA: string; instanceB: string }>();
    const a = manager.get(instanceA);
    const b = manager.get(instanceB);
    if (!a || !b) return c.json({ error: "one or both instances not found" }, 404);
    return c.json({ a: a.config, b: b.config });
  });

  return app;
}
