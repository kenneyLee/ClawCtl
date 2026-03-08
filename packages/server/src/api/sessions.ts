import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { InstanceManager } from "../instances/manager.js";
import type { LlmClient } from "../llm/client.js";
import { requireWrite } from "../auth/middleware.js";

export function sessionRoutes(manager: InstanceManager, llm: LlmClient, db?: Database.Database) {
  const app = new Hono();

  app.get("/:id/sessions", async (c) => {
    const info = manager.get(c.req.param("id"));
    if (!info) return c.json({ error: "instance not found" }, 404);
    if (db) {
      const aliases = db.prepare("SELECT session_key, alias FROM session_aliases WHERE instance_id = ?").all(c.req.param("id")!) as { session_key: string; alias: string }[];
      const aliasMap = new Map(aliases.map((a) => [a.session_key, a.alias]));
      return c.json(info.sessions.map((s) => ({ ...s, alias: aliasMap.get(s.key) })));
    }
    return c.json(info.sessions);
  });

  app.put("/:id/sessions/:key/alias", requireWrite("sessions"), async (c) => {
    const { alias } = await c.req.json<{ alias: string }>();
    if (!db) return c.json({ error: "no database" }, 500);
    const instanceId = c.req.param("id")!;
    const sessionKey = c.req.param("key")!;
    if (alias) {
      db.prepare("INSERT OR REPLACE INTO session_aliases (instance_id, session_key, alias) VALUES (?, ?, ?)").run(instanceId, sessionKey, alias);
    } else {
      db.prepare("DELETE FROM session_aliases WHERE instance_id = ? AND session_key = ?").run(instanceId, sessionKey);
    }
    return c.json({ ok: true });
  });

  app.get("/:id/sessions/:key", async (c) => {
    const client = manager.getClient(c.req.param("id"));
    if (!client) return c.json({ error: "instance not found" }, 404);
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Math.min(Math.max(1, parseInt(limitStr, 10) || 50), 1000) : undefined;
    const messages = await client.fetchSessionHistory(c.req.param("key"), limit);
    return c.json(messages);
  });

  app.post("/:id/sessions/:key/summarize", requireWrite("sessions"), async (c) => {
    if (!llm.isConfigured()) {
      return c.json({ error: "LLM not configured. Set API key in Settings." }, 400);
    }
    const client = manager.getClient(c.req.param("id"));
    if (!client) return c.json({ error: "instance not found" }, 404);

    const messages = await client.fetchSessionHistory(c.req.param("key"));
    const transcript = messages
      .map((m: any) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n")
      .slice(0, 8000);

    const result = await llm.complete({
      system: "Summarize this AI assistant conversation in 2-3 sentences. Include key topics and any actions taken. Respond in the same language as the conversation.",
      prompt: transcript,
      maxTokens: 300,
    });

    return c.json({ summary: result.text, tokensUsed: result.tokensUsed });
  });

  return app;
}
