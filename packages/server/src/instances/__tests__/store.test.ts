import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      token TEXT,
      label TEXT,
      auto_discovered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      output TEXT DEFAULT '',
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS config_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

describe("Store (SQLite schema)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates all 4 tables", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("instances");
    expect(names).toContain("operations");
    expect(names).toContain("config_snapshots");
    expect(names).toContain("settings");
  });

  it("WAL pragma is accepted", () => {
    // In-memory DBs can't use WAL (falls back to "memory"), but pragma succeeds.
    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(["wal", "memory"]).toContain(result[0].journal_mode);
  });

  it("instances CRUD", () => {
    db.prepare("INSERT INTO instances (id, url, label) VALUES (?, ?, ?)").run("i1", "ws://localhost:18789", "default");
    const row = db.prepare("SELECT * FROM instances WHERE id = ?").get("i1") as any;
    expect(row.url).toBe("ws://localhost:18789");
    expect(row.label).toBe("default");

    db.prepare("UPDATE instances SET label = ? WHERE id = ?").run("updated", "i1");
    const updated = db.prepare("SELECT * FROM instances WHERE id = ?").get("i1") as any;
    expect(updated.label).toBe("updated");

    db.prepare("DELETE FROM instances WHERE id = ?").run("i1");
    const deleted = db.prepare("SELECT * FROM instances WHERE id = ?").get("i1");
    expect(deleted).toBeUndefined();
  });

  it("operations insert and query", () => {
    db.prepare("INSERT INTO operations (instance_id, type, status) VALUES (?, ?, ?)").run("i1", "diagnose", "running");
    db.prepare("INSERT INTO operations (instance_id, type, status) VALUES (?, ?, ?)").run("i1", "refresh", "completed");

    const running = db.prepare("SELECT * FROM operations WHERE status = ?").all("running") as any[];
    expect(running).toHaveLength(1);
    expect(running[0].type).toBe("diagnose");
  });

  it("config_snapshots insert and query", () => {
    db.prepare("INSERT INTO config_snapshots (instance_id, config_json) VALUES (?, ?)").run("i1", '{"key":"value"}');
    const snaps = db.prepare("SELECT * FROM config_snapshots WHERE instance_id = ?").all("i1") as any[];
    expect(snaps).toHaveLength(1);
    expect(JSON.parse(snaps[0].config_json)).toEqual({ key: "value" });
  });

  it("settings upsert", () => {
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    upsert.run("llm", '{"provider":"openai"}');
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("llm") as any;
    expect(JSON.parse(row.value).provider).toBe("openai");

    upsert.run("llm", '{"provider":"anthropic"}');
    const updated = db.prepare("SELECT value FROM settings WHERE key = ?").get("llm") as any;
    expect(JSON.parse(updated.value).provider).toBe("anthropic");
  });
});
