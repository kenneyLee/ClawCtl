import type Database from "better-sqlite3";

function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

export class SnapshotStore {
  constructor(private db: Database.Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    // Migration: add reason column if table was created without it
    try {
      this.db.exec(`ALTER TABLE config_snapshots ADD COLUMN reason TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  create(instanceId: string, configJson: string, reason?: string): number {
    const stmt = this.db.prepare(
      "INSERT INTO config_snapshots (instance_id, config_json, reason) VALUES (?, ?, ?)"
    );
    const result = stmt.run(instanceId, configJson, reason ?? null);
    return result.lastInsertRowid as number;
  }

  list(
    instanceId: string
  ): Array<{
    id: number;
    instance_id: string;
    reason: string | null;
    created_at: string;
  }> {
    const stmt = this.db.prepare(
      "SELECT id, instance_id, reason, created_at FROM config_snapshots WHERE instance_id = ? ORDER BY id DESC"
    );
    return stmt.all(instanceId) as any;
  }

  get(
    id: number
  ):
    | {
        id: number;
        instance_id: string;
        config_json: string;
        reason: string | null;
        created_at: string;
      }
    | undefined {
    const stmt = this.db.prepare(
      "SELECT id, instance_id, config_json, reason, created_at FROM config_snapshots WHERE id = ?"
    );
    return stmt.get(id) as any;
  }

  diff(
    id1: number,
    id2: number
  ): {
    before: Record<string, any>;
    after: Record<string, any>;
    changes: Array<{ path: string; before: any; after: any }>;
  } {
    const s1 = this.get(id1);
    const s2 = this.get(id2);
    if (!s1) throw new Error(`Snapshot ${id1} not found`);
    if (!s2) throw new Error(`Snapshot ${id2} not found`);

    const before = JSON.parse(s1.config_json);
    const after = JSON.parse(s2.config_json);
    const flatBefore = flattenObject(before);
    const flatAfter = flattenObject(after);

    const allKeys = new Set([
      ...Object.keys(flatBefore),
      ...Object.keys(flatAfter),
    ]);
    const changes: Array<{ path: string; before: any; after: any }> = [];

    for (const key of allKeys) {
      const bVal = flatBefore[key];
      const aVal = flatAfter[key];
      if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.push({ path: key, before: bVal, after: aVal });
      }
    }

    return { before, after, changes };
  }

  cleanup(instanceId: string, keepCount = 50): number {
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM config_snapshots WHERE instance_id = ?"
    );
    const { cnt } = countStmt.get(instanceId) as { cnt: number };

    if (cnt <= keepCount) return 0;

    const deleteCount = cnt - keepCount;
    const delStmt = this.db.prepare(
      `DELETE FROM config_snapshots WHERE id IN (
        SELECT id FROM config_snapshots WHERE instance_id = ? ORDER BY id ASC LIMIT ?
      )`
    );
    const result = delStmt.run(instanceId, deleteCount);
    return result.changes;
  }
}
