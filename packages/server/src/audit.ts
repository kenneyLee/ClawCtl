import type { Context } from "hono";
import type Database from "better-sqlite3";

/**
 * Log an auditable operation with operator info extracted from request context.
 *
 * @param db - SQLite database
 * @param c - Hono request context (contains user from auth middleware)
 * @param type - Operation type (e.g. "user.create", "host.delete", "lifecycle.stop")
 * @param detail - Human-readable detail of what happened
 * @param instanceId - Optional instance/target ID
 */
export function auditLog(
  db: Database.Database,
  c: Context,
  type: string,
  detail: string,
  instanceId?: string,
) {
  const user = c.get("user");
  const operator = user ? `${user.username} (${user.role})` : "system";
  db.prepare(
    "INSERT INTO operations (instance_id, type, status, output, operator, finished_at) VALUES (?, ?, 'success', ?, ?, datetime('now'))"
  ).run(instanceId || null, type, detail, operator);
}
