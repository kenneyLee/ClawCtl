import type Database from "better-sqlite3";
import type { Role, User, UserRow } from "./types.js";
import { hashPassword, verifyPassword } from "./password.js";

export class UserStore {
  constructor(private db: Database.Database) {}

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'auditor',
        created_at TEXT DEFAULT (datetime('now')),
        last_login TEXT
      );
    `);
  }

  hasAnyUser(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
    return row.cnt > 0;
  }

  createUser(username: string, password: string, role: Role): User {
    const { hash, salt } = hashPassword(password);
    const info = this.db.prepare(
      "INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)"
    ).run(username, hash, salt, role);
    return { id: info.lastInsertRowid as number, username, role, created_at: new Date().toISOString(), last_login: null };
  }

  authenticate(username: string, password: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash, row.salt)) return null;
    this.db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(row.id);
    return { id: row.id, username: row.username, role: row.role, created_at: row.created_at, last_login: new Date().toISOString() };
  }

  getUser(id: number): User | null {
    const row = this.db.prepare("SELECT id, username, role, created_at, last_login FROM users WHERE id = ?").get(id) as User | undefined;
    return row || null;
  }

  listUsers(): User[] {
    return this.db.prepare("SELECT id, username, role, created_at, last_login FROM users ORDER BY id").all() as User[];
  }

  updateUser(id: number, updates: { role?: Role; password?: string }): boolean {
    if (updates.password) {
      const { hash, salt } = hashPassword(updates.password);
      this.db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, id);
    }
    if (updates.role) {
      this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(updates.role, id);
    }
    return true;
  }

  deleteUser(id: number): boolean {
    const info = this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return info.changes > 0;
  }
}
