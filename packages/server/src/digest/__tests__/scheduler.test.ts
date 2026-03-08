import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { DigestScheduler } from "../scheduler.js";
import type { LlmClient } from "../../llm/client.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      output TEXT DEFAULT '',
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    )
  `);
  return db;
}

function makeLlm(configured: boolean, chatFn?: (...args: any[]) => any): LlmClient {
  return {
    isConfigured: () => configured,
    complete: chatFn ?? vi.fn(),
    configure: vi.fn(),
  } as any;
}

describe("DigestScheduler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  it("generateDigest daily without LLM", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i1",
      "lifecycle.start",
      "ok",
    );
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i1",
      "lifecycle.start",
      "ok",
    );
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i2",
      "auth.login",
      "ok",
    );

    const scheduler = new DigestScheduler(makeLlm(false), db);
    const digest = await scheduler.generateDigest("daily");

    expect(digest.title).toBe("OpenClaw Daily Digest");
    expect(digest.summary).toBe("3 operations recorded");
    expect(digest.stats["lifecycle.start.ok"]).toBe(2);
    expect(digest.stats["auth.login.ok"]).toBe(1);
    expect(digest.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(digest.generatedAt).toBeTruthy();
    expect(digest.highlights.length).toBeGreaterThan(0);
  });

  it("generateDigest weekly without LLM", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i1",
      "config.update",
      "ok",
    );

    const scheduler = new DigestScheduler(makeLlm(false), db);
    const digest = await scheduler.generateDigest("weekly");

    expect(digest.title).toBe("OpenClaw Weekly Digest");
    expect(digest.summary).toBe("1 operations recorded");
    expect(digest.period).toMatch(/^\d{4}-W\d{2}$/);
    expect(digest.stats["config.update.ok"]).toBe(1);
  });

  it("generateDigest with no operations", async () => {
    const scheduler = new DigestScheduler(makeLlm(false), db);
    const digest = await scheduler.generateDigest("daily");

    expect(digest.title).toBe("OpenClaw Daily Digest");
    expect(digest.summary).toBe("0 operations recorded");
    expect(Object.keys(digest.stats)).toHaveLength(0);
    expect(digest.highlights).toHaveLength(0);
    expect(digest.period).toBeTruthy();
    expect(digest.generatedAt).toBeTruthy();
  });

  it("generateDigest with LLM configured", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i1",
      "diagnose",
      "ok",
    );

    const mockChat = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: "LLM Title",
        summary: "LLM summary text",
        highlights: ["highlight one", "highlight two"],
      }),
    });

    const scheduler = new DigestScheduler(makeLlm(true, mockChat), db);
    const digest = await scheduler.generateDigest("daily");

    expect(mockChat).toHaveBeenCalledOnce();
    expect(digest.title).toBe("LLM Title");
    expect(digest.summary).toBe("LLM summary text");
    expect(digest.highlights).toEqual(["highlight one", "highlight two"]);
    expect(digest.stats["diagnose.ok"]).toBe(1);
  });

  it("generateDigest falls back when LLM fails", async () => {
    db.prepare("INSERT INTO operations (instance_id, type, status, started_at) VALUES (?, ?, ?, datetime('now'))").run(
      "i1",
      "diagnose",
      "error",
    );

    const mockChat = vi.fn().mockRejectedValue(new Error("API timeout"));

    const scheduler = new DigestScheduler(makeLlm(true, mockChat), db);
    const digest = await scheduler.generateDigest("daily");

    expect(digest.title).toBe("OpenClaw Daily Digest");
    expect(digest.summary).toBe("1 operations recorded");
    expect(digest.stats["diagnose.error"]).toBe(1);
  });

  it("isValidCron validates correct expressions", () => {
    expect(DigestScheduler.isValidCron("0 9 * * 1")).toBe(true);
    expect(DigestScheduler.isValidCron("*/5 * * * *")).toBe(true);
    expect(DigestScheduler.isValidCron("0 0 1 1 *")).toBe(true);
    expect(DigestScheduler.isValidCron("0,30 * * * *")).toBe(true);
    expect(DigestScheduler.isValidCron("0-5 * * * *")).toBe(true);
  });

  it("isValidCron rejects invalid expressions", () => {
    expect(DigestScheduler.isValidCron("bad cron")).toBe(false);
    expect(DigestScheduler.isValidCron("")).toBe(false);
    expect(DigestScheduler.isValidCron("1 2 3")).toBe(false);
    expect(DigestScheduler.isValidCron("a b c d e")).toBe(false);
    expect(DigestScheduler.isValidCron("* * * * * *")).toBe(false); // 6 parts
  });

  it("pushToFeishu returns error on network failure", async () => {
    const scheduler = new DigestScheduler(makeLlm(false), db);
    const digest = {
      title: "Test",
      summary: "Test summary",
      highlights: [],
      stats: {},
      period: "2026-03-07",
      generatedAt: new Date().toISOString(),
    };

    const result = await scheduler.pushToFeishu(digest, "http://localhost:1/nonexistent");
    expect(result.channel).toBe("feishu");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("pushToTelegram returns error on network failure", async () => {
    // Mock fetch to simulate network failure instead of hitting real Telegram API
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    try {
      const scheduler = new DigestScheduler(makeLlm(false), db);
      const digest = {
        title: "Test",
        summary: "Test summary",
        highlights: [],
        stats: {},
        period: "2026-03-07",
        generatedAt: new Date().toISOString(),
      };

      const result = await scheduler.pushToTelegram(digest, "invalid-token", "12345");
      expect(result.channel).toBe("telegram");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
