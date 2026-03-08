import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SnapshotStore } from "../snapshot.js";

describe("SnapshotStore", () => {
  let db: Database.Database;
  let store: SnapshotStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new SnapshotStore(db);
    store.init();
  });

  it("create and list snapshots", () => {
    store.create("inst-1", '{"a":1}', "first");
    store.create("inst-1", '{"a":2}', "second");

    const list = store.list("inst-1");
    expect(list).toHaveLength(2);
    // desc order — newest first
    expect(list[0].reason).toBe("second");
    expect(list[1].reason).toBe("first");
    // config_json must NOT be in list results
    for (const row of list) {
      expect(row).not.toHaveProperty("config_json");
    }
  });

  it("get returns full snapshot with config_json", () => {
    const id = store.create("inst-1", '{"model":"gpt-4"}', "initial");
    const snap = store.get(id);
    expect(snap).toBeDefined();
    expect(snap!.config_json).toBe('{"model":"gpt-4"}');
    expect(snap!.instance_id).toBe("inst-1");
    expect(snap!.reason).toBe("initial");
    expect(snap!.created_at).toBeTruthy();
  });

  it("diff detects changes", () => {
    const id1 = store.create(
      "inst-1",
      JSON.stringify({ agents: { defaults: { model: { primary: "gpt-4" } } } }),
      "before"
    );
    const id2 = store.create(
      "inst-1",
      JSON.stringify({ agents: { defaults: { model: { primary: "gpt-4o" } } } }),
      "after"
    );

    const result = store.diff(id1, id2);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({
      path: "agents.defaults.model.primary",
      before: "gpt-4",
      after: "gpt-4o",
    });
  });

  it("diff detects added and removed keys", () => {
    const id1 = store.create(
      "inst-1",
      JSON.stringify({ keyA: "valueA" }),
      "has A"
    );
    const id2 = store.create(
      "inst-1",
      JSON.stringify({ keyB: "valueB" }),
      "has B"
    );

    const result = store.diff(id1, id2);
    expect(result.changes).toHaveLength(2);

    const removed = result.changes.find((c) => c.path === "keyA");
    expect(removed).toEqual({ path: "keyA", before: "valueA", after: undefined });

    const added = result.changes.find((c) => c.path === "keyB");
    expect(added).toEqual({ path: "keyB", before: undefined, after: "valueB" });
  });

  it("cleanup keeps only keepCount", () => {
    for (let i = 0; i < 10; i++) {
      store.create("inst-1", `{"v":${i}}`, `snap-${i}`);
    }
    expect(store.list("inst-1")).toHaveLength(10);

    store.cleanup("inst-1", 3);

    const remaining = store.list("inst-1");
    expect(remaining).toHaveLength(3);
    // newest 3 should remain (snap-7, snap-8, snap-9)
    expect(remaining[0].reason).toBe("snap-9");
    expect(remaining[1].reason).toBe("snap-8");
    expect(remaining[2].reason).toBe("snap-7");
  });

  it("cleanup returns count deleted", () => {
    for (let i = 0; i < 10; i++) {
      store.create("inst-1", `{"v":${i}}`, `snap-${i}`);
    }

    const deleted = store.cleanup("inst-1", 3);
    expect(deleted).toBe(7);

    // cleanup when already within limit
    const deletedAgain = store.cleanup("inst-1", 3);
    expect(deletedAgain).toBe(0);
  });
});
