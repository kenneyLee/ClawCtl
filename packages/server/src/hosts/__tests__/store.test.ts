import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { HostStore } from "../store.js";

describe("HostStore", () => {
  let store: HostStore;

  beforeEach(() => {
    const db = new Database(":memory:");
    store = new HostStore(db, "test-secret");
    store.init();
  });

  it("creates and lists hosts with masked credentials", () => {
    store.create({ label: "prod", host: "10.0.0.1", port: 22, username: "ubuntu", authMethod: "password", credential: "secret123" });
    const hosts = store.list();
    expect(hosts).toHaveLength(1);
    expect(hosts[0].label).toBe("prod");
    expect(hosts[0].credential).toBe("***");
  });

  it("decrypts credential correctly", () => {
    const host = store.create({ label: "test", host: "10.0.0.2", username: "root", authMethod: "privateKey", credential: "-----BEGIN KEY-----" });
    const cred = store.getDecryptedCredential(host.id);
    expect(cred).toBe("-----BEGIN KEY-----");
  });

  it("updates host fields", () => {
    const host = store.create({ label: "old", host: "1.2.3.4", username: "user", authMethod: "password", credential: "pass" });
    const updated = store.update(host.id, { label: "new", port: 2222 });
    expect(updated?.label).toBe("new");
    expect(updated?.port).toBe(2222);
    // credential unchanged
    expect(store.getDecryptedCredential(host.id)).toBe("pass");
  });

  it("updates credential when provided", () => {
    const host = store.create({ label: "t", host: "1.1.1.1", username: "u", authMethod: "password", credential: "old" });
    store.update(host.id, { credential: "new" });
    expect(store.getDecryptedCredential(host.id)).toBe("new");
  });

  it("deletes host", () => {
    const host = store.create({ label: "del", host: "9.9.9.9", username: "x", authMethod: "password", credential: "y" });
    expect(store.delete(host.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("returns false for deleting non-existent host", () => {
    expect(store.delete(999)).toBe(false);
  });

  it("updates scan result", () => {
    const host = store.create({ label: "s", host: "1.1.1.1", username: "u", authMethod: "password", credential: "p" });
    store.updateScanResult(host.id, null);
    const h = store.get(host.id)!;
    expect(h.last_scan_at).toBeTruthy();
    expect(h.last_scan_error).toBeNull();
  });

  it("updates scan error", () => {
    const host = store.create({ label: "s", host: "1.1.1.1", username: "u", authMethod: "password", credential: "p" });
    store.updateScanResult(host.id, "connection refused");
    const h = store.get(host.id)!;
    expect(h.last_scan_error).toBe("connection refused");
  });
});
