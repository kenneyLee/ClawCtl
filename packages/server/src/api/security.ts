import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { InstanceManager } from "../instances/manager.js";
import type { LlmClient } from "../llm/client.js";
import { requireWrite, requireRole } from "../auth/middleware.js";
import { InjectionDetector } from "../security/injection.js";
import { PermissionTemplateStore } from "../security/templates.js";

export function securityRoutes(manager: InstanceManager, db: Database.Database, llm: LlmClient) {
  const app = new Hono();
  const detector = new InjectionDetector(llm);
  const templateStore = new PermissionTemplateStore(db);
  templateStore.init();

  // --- Instance security audit (existing) ---

  app.get("/:id/security", (c) => {
    const info = manager.get(c.req.param("id"));
    if (!info) return c.json({ error: "instance not found" }, 404);
    return c.json(info.securityAudit || []);
  });

  app.get("/overview", (c) => {
    const all = manager.getAll();
    const overview = all.map((inst) => ({
      instanceId: inst.id,
      label: inst.connection.label,
      issues: inst.securityAudit || [],
      criticalCount: (inst.securityAudit || []).filter((i) => i.level === "critical").length,
      warnCount: (inst.securityAudit || []).filter((i) => i.level === "warn").length,
    }));
    return c.json(overview);
  });

  // --- Injection detection ---

  app.post("/scan-message", requireWrite("security"), async (c) => {
    const { message } = await c.req.json<{ message: string }>();
    if (!message) return c.json({ error: "message is required" }, 400);
    const result = await detector.detect(message);
    return c.json(result);
  });

  // --- Permission templates ---

  app.get("/templates", (c) => {
    return c.json(templateStore.listAll());
  });

  app.get("/templates/:id", (c) => {
    const tmpl = templateStore.getTemplate(c.req.param("id"));
    if (!tmpl) return c.json({ error: "template not found" }, 404);
    return c.json(tmpl);
  });

  app.post("/templates", requireRole("admin"), async (c) => {
    const body = await c.req.json<{ id: string; name: string; description?: string; config: any }>();
    if (!body.id || !body.name || !body.config) return c.json({ error: "id, name, and config are required" }, 400);
    try {
      const tmpl = templateStore.createCustom(body);
      return c.json(tmpl, 201);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) return c.json({ error: "Template ID already exists" }, 409);
      throw e;
    }
  });

  app.put("/templates/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const tmpl = templateStore.updateCustom(id, body);
    if (!tmpl) return c.json({ error: "template not found or is a preset" }, 404);
    return c.json(tmpl);
  });

  app.delete("/templates/:id", requireRole("admin"), (c) => {
    const id = c.req.param("id");
    if (!templateStore.deleteCustom(id)) return c.json({ error: "template not found or is a preset" }, 404);
    return c.json({ ok: true });
  });

  app.post("/templates/:id/preview", requireWrite("security"), async (c) => {
    const templateId = c.req.param("id");
    const { agentConfig } = await c.req.json<{ agentConfig: Record<string, any> }>();
    if (!agentConfig) return c.json({ error: "agentConfig is required" }, 400);
    try {
      const diff = templateStore.applyToAgent(templateId, agentConfig);
      return c.json(diff);
    } catch (err: any) {
      return c.json({ error: err.message }, 404);
    }
  });

  return app;
}
