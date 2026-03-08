import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { InstanceManager } from "../instances/manager.js";
import type { LlmClient } from "../llm/client.js";
import { requireWrite } from "../auth/middleware.js";
import { DigestScheduler } from "../digest/scheduler.js";

export function digestRoutes(manager: InstanceManager, llm: LlmClient, db: Database.Database) {
  const app = new Hono();
  const scheduler = new DigestScheduler(llm, db);

  // Existing: generate from live instance data (requires LLM)
  app.post("/", requireWrite("digest"), async (c) => {
    if (!llm.isConfigured()) {
      return c.json({ error: "LLM not configured. Set API key in Settings." }, 400);
    }

    const all = manager.getAll();
    const summaryParts: string[] = [];

    for (const inst of all) {
      const sessionCount = inst.sessions.length;
      const channels = inst.channels.map((ch) => ch.type).join(", ");
      const agents = inst.agents.map((a) => a.id).join(", ");
      summaryParts.push(
        `Instance "${inst.connection.label || inst.id}": ${sessionCount} sessions, channels: [${channels}], agents: [${agents}]`
      );
    }

    const result = await llm.complete({
      system: "Generate a concise daily digest for an OpenClaw admin. Highlight notable activity, potential issues, and recommendations. Respond in the same language as the input.",
      prompt: `Instance overview:\n${summaryParts.join("\n")}`,
      maxTokens: 500,
    });

    return c.json({ digest: result.text, tokensUsed: result.tokensUsed });
  });

  // Generate from operations data (works without LLM via fallback)
  app.post("/generate", requireWrite("digest"), async (c) => {
    const { type } = await c.req.json<{ type: "daily" | "weekly" }>().catch(() => ({ type: "daily" as const }));
    const digest = await scheduler.generateDigest(type);
    return c.json(digest);
  });

  // Push digest to Feishu
  app.post("/push/feishu", requireWrite("digest"), async (c) => {
    const { type, webhookUrl } = await c.req.json<{ type: "daily" | "weekly"; webhookUrl: string }>();
    if (!webhookUrl) return c.json({ error: "webhookUrl is required" }, 400);
    const digest = await scheduler.generateDigest(type || "daily");
    const result = await scheduler.pushToFeishu(digest, webhookUrl);
    return c.json(result);
  });

  // Push digest to Telegram
  app.post("/push/telegram", requireWrite("digest"), async (c) => {
    const { type, botToken, chatId } = await c.req.json<{ type: "daily" | "weekly"; botToken: string; chatId: string }>();
    if (!botToken || !chatId) return c.json({ error: "botToken and chatId are required" }, 400);
    const digest = await scheduler.generateDigest(type || "daily");
    const result = await scheduler.pushToTelegram(digest, botToken, chatId);
    return c.json(result);
  });

  // Validate cron expression
  app.post("/cron/validate", async (c) => {
    const { expr } = await c.req.json<{ expr: string }>();
    return c.json({ valid: DigestScheduler.isValidCron(expr || "") });
  });

  return app;
}
