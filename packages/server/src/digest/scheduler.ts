import type { LlmClient } from "../llm/client.js";
import type Database from "better-sqlite3";

export interface Digest {
  title: string;
  summary: string;
  highlights: string[];
  stats: Record<string, number>;
  period: string; // e.g. "2026-03-07" or "2026-W10"
  generatedAt: string; // ISO timestamp
}

export interface PushResult {
  channel: "feishu" | "telegram";
  success: boolean;
  error?: string;
}

function formatDigestMarkdown(digest: Digest): string {
  let md = `**${digest.title}**\n\n${digest.summary}\n`;
  if (digest.highlights.length) {
    md += "\n**Highlights:**\n";
    for (const h of digest.highlights) md += `- ${h}\n`;
  }
  if (Object.keys(digest.stats).length) {
    md += "\n**Stats:**\n";
    for (const [k, v] of Object.entries(digest.stats)) md += `- ${k}: ${v}\n`;
  }
  md += `\n_Period: ${digest.period} | Generated: ${digest.generatedAt}_`;
  return md;
}

function computePeriodLabel(type: "daily" | "weekly", now: Date): string {
  if (type === "daily") {
    return now.toISOString().slice(0, 10); // "2026-03-07"
  }
  // ISO week number
  const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class DigestScheduler {
  constructor(
    private llm: LlmClient,
    private db: Database.Database,
  ) {}

  async generateDigest(type: "daily" | "weekly"): Promise<Digest> {
    const now = new Date();
    const hoursBack = type === "daily" ? 24 : 24 * 7;
    const since = new Date(now.getTime() - hoursBack * 3600_000).toISOString();

    const rows = this.db
      .prepare<[string], { type: string; status: string; count: number }>(
        "SELECT type, status, COUNT(*) as count FROM operations WHERE started_at >= ? GROUP BY type, status",
      )
      .all(since);

    const stats: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.type}.${row.status}`;
      stats[key] = row.count;
    }

    const totalOps = rows.reduce((sum, r) => sum + r.count, 0);
    const period = computePeriodLabel(type, now);

    if (this.llm.isConfigured()) {
      try {
        const resp = await this.llm.complete({
          system:
            "Generate a brief operational digest for an OpenClaw management platform. Return JSON: {title, summary, highlights[]}",
          prompt: `Period: ${type}. Operations summary: ${JSON.stringify(stats)}`,
          maxTokens: 500,
        });
        const parsed = JSON.parse(resp.text) as {
          title: string;
          summary: string;
          highlights: string[];
        };
        return {
          title: parsed.title,
          summary: parsed.summary,
          highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
          stats,
          period,
          generatedAt: now.toISOString(),
        };
      } catch {
        // LLM failed — fall through to fallback
      }
    }

    // Fallback: no LLM or LLM error
    const typeLabel = type === "daily" ? "Daily" : "Weekly";
    const topTypes = Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`);

    return {
      title: `OpenClaw ${typeLabel} Digest`,
      summary: `${totalOps} operations recorded`,
      highlights: topTypes,
      stats,
      period,
      generatedAt: now.toISOString(),
    };
  }

  async pushToFeishu(digest: Digest, webhookUrl: string): Promise<PushResult> {
    try {
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "interactive",
          card: {
            header: { title: { tag: "plain_text", content: digest.title } },
            elements: [{ tag: "markdown", content: formatDigestMarkdown(digest) }],
          },
        }),
      });
      if (!resp.ok) {
        return { channel: "feishu", success: false, error: `HTTP ${resp.status}` };
      }
      return { channel: "feishu", success: true };
    } catch (err: any) {
      return { channel: "feishu", success: false, error: err.message };
    }
  }

  async pushToTelegram(digest: Digest, botToken: string, chatId: string): Promise<PushResult> {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: formatDigestMarkdown(digest),
          parse_mode: "Markdown",
        }),
      });
      if (!resp.ok) {
        return { channel: "telegram", success: false, error: `HTTP ${resp.status}` };
      }
      return { channel: "telegram", success: true };
    } catch (err: any) {
      return { channel: "telegram", success: false, error: err.message };
    }
  }

  static isValidCron(expr: string): boolean {
    if (!expr) return false;
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return parts.every((p) => /^[\d*\/\-,]+$/.test(p));
  }
}
