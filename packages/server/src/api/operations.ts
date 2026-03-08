import { Hono } from "hono";
import type Database from "better-sqlite3";

export function operationRoutes(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query("pageSize") || "50")));
    const operator = c.req.query("operator")?.trim();
    const from = c.req.query("from")?.trim();
    const to = c.req.query("to")?.trim();

    const conditions: string[] = [];
    const params: any[] = [];

    if (operator) {
      conditions.push("operator LIKE ?");
      params.push(`%${operator}%`);
    }
    if (from) {
      conditions.push("started_at >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("started_at <= ?");
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM operations ${where}`).get(...params) as { cnt: number }).cnt;
    const offset = (page - 1) * pageSize;
    const ops = db.prepare(`SELECT * FROM operations ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

    return c.json({ data: ops, total, page, pageSize });
  });

  app.get("/:id/stream", (c) => {
    const op = db.prepare("SELECT * FROM operations WHERE id = ?").get(c.req.param("id"));
    if (!op) return c.json({ error: "operation not found" }, 404);
    return c.json(op);
  });

  return app;
}
