import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { PermissionTemplateStore } from "../templates.js";

describe("PermissionTemplateStore", () => {
  let db: Database.Database;
  let store: PermissionTemplateStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new PermissionTemplateStore(db);
    store.init();
  });

  it("listPresets returns 3 templates", () => {
    const presets = store.listPresets();
    expect(presets).toHaveLength(3);
    expect(presets.map((p) => p.id)).toEqual(["enterprise", "social", "personal"]);
  });

  it("enterprise preset has restrictive config", () => {
    const t = store.getTemplate("enterprise")!;
    expect(t.config.toolsAllow).toEqual(["read", "search", "list"]);
    expect(t.config.execSecurity).toBe("allowlist");
    expect(t.config.workspaceOnly).toBe(true);
  });

  it("personal preset has permissive config", () => {
    const t = store.getTemplate("personal")!;
    expect(t.config.toolsAllow).toContain("*");
    expect(t.config.execSecurity).toBe("full");
    expect(t.config.workspaceOnly).toBe(false);
  });

  it("applyToAgent returns diff", () => {
    const agentConfig = {
      name: "test-agent",
      tools: { allow: ["*"], exec: { security: "full" } },
    };
    const diff = store.applyToAgent("enterprise", agentConfig);
    expect(diff.agentName).toBe("test-agent");
    expect(diff.before.toolsAllow).toEqual(["*"]);
    expect(diff.before.execSecurity).toBe("full");
    expect(diff.after.toolsAllow).toEqual(["read", "search", "list"]);
    expect(diff.after.execSecurity).toBe("allowlist");
    expect(diff.after.workspaceOnly).toBe(true);
  });

  it("createCustom and listCustom", () => {
    store.createCustom({
      id: "my-template",
      name: "My Template",
      description: "Custom template",
      config: { toolsAllow: ["read"], execSecurity: "disabled", workspaceOnly: true },
    });
    const custom = store.listCustom();
    expect(custom).toHaveLength(1);
    expect(custom[0].id).toBe("my-template");
    expect(custom[0].preset).toBe(false);

    const all = store.listAll();
    expect(all).toHaveLength(4);
  });

  it("updateCustom", () => {
    store.createCustom({
      id: "updatable",
      name: "Original",
      config: { toolsAllow: ["read"], execSecurity: "disabled", workspaceOnly: false },
    });
    const updated = store.updateCustom("updatable", { name: "Renamed" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.config.toolsAllow).toEqual(["read"]);
  });

  it("deleteCustom", () => {
    store.createCustom({
      id: "deletable",
      name: "Temp",
      config: { toolsAllow: ["*"], execSecurity: "full", workspaceOnly: false },
    });
    expect(store.deleteCustom("deletable")).toBe(true);
    expect(store.getTemplate("deletable")).toBeUndefined();
  });

  it("cannot update/delete presets", () => {
    expect(store.updateCustom("enterprise", { name: "Hacked" })).toBeUndefined();
    expect(store.deleteCustom("enterprise")).toBe(false);
  });
});
