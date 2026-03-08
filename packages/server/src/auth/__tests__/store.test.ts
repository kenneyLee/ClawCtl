import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { UserStore } from "../store.js";

describe("UserStore", () => {
  let db: Database.Database;
  let store: UserStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    store = new UserStore(db);
    store.init();
  });

  it("init creates users table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
    expect(tables).toHaveLength(1);
  });

  it("hasAnyUser returns false initially", () => {
    expect(store.hasAnyUser()).toBe(false);
  });

  it("createUser then hasAnyUser returns true", () => {
    store.createUser("admin", "password123", "admin");
    expect(store.hasAnyUser()).toBe(true);
  });

  it("createUser returns User without password fields", () => {
    const user = store.createUser("admin", "password123", "admin");
    expect(user.id).toBe(1);
    expect(user.username).toBe("admin");
    expect(user.role).toBe("admin");
    expect(user.created_at).toBeDefined();
    expect(user.last_login).toBeNull();
    expect((user as any).password_hash).toBeUndefined();
    expect((user as any).salt).toBeUndefined();
  });

  it("authenticate with correct credentials returns User", () => {
    store.createUser("admin", "password123", "admin");
    const user = store.authenticate("admin", "password123");
    expect(user).not.toBeNull();
    expect(user!.username).toBe("admin");
    expect(user!.last_login).not.toBeNull();
  });

  it("authenticate with wrong password returns null", () => {
    store.createUser("admin", "password123", "admin");
    expect(store.authenticate("admin", "wrongpass")).toBeNull();
  });

  it("authenticate with nonexistent user returns null", () => {
    expect(store.authenticate("ghost", "password")).toBeNull();
  });

  it("listUsers returns all users", () => {
    store.createUser("alice", "pass123456", "admin");
    store.createUser("bob", "pass123456", "operator");
    const users = store.listUsers();
    expect(users).toHaveLength(2);
    expect(users.map(u => u.username)).toEqual(["alice", "bob"]);
  });

  it("updateUser changes role", () => {
    const user = store.createUser("alice", "pass123456", "operator");
    store.updateUser(user.id, { role: "admin" });
    const updated = store.getUser(user.id);
    expect(updated!.role).toBe("admin");
  });

  it("updateUser changes password", () => {
    const user = store.createUser("alice", "oldpass123", "admin");
    store.updateUser(user.id, { password: "newpass123" });
    expect(store.authenticate("alice", "oldpass123")).toBeNull();
    expect(store.authenticate("alice", "newpass123")).not.toBeNull();
  });

  it("deleteUser removes user", () => {
    const user = store.createUser("alice", "pass123456", "admin");
    expect(store.deleteUser(user.id)).toBe(true);
    expect(store.getUser(user.id)).toBeNull();
  });

  it("createUser with duplicate username throws", () => {
    store.createUser("alice", "pass123456", "admin");
    expect(() => store.createUser("alice", "pass123456", "operator")).toThrow(/UNIQUE/);
  });
});
