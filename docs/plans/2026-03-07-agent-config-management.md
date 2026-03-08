# Agent Config Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add agent CRUD, global defaults editing, template apply, and restart-after-save to the Instance detail page.

**Architecture:** New `lifecycle/agent-config.ts` module with pure helper functions. Three new endpoints in `api/lifecycle.ts`. New `AgentsTab` component in `Instance.tsx` with sub-components for the form, template modal, and restart dialog.

**Tech Stack:** TypeScript, Hono, Vitest (backend); React, Tailwind CSS (frontend). Existing `readRemoteConfig`/`writeRemoteConfig` for config I/O. Existing `SnapshotStore` for auto-snapshots.

---

## Task 1: Backend helper — `lifecycle/agent-config.ts`

**Files:**
- Create: `packages/server/src/lifecycle/agent-config.ts`
- Test: `packages/server/src/lifecycle/__tests__/agent-config.test.ts`

### Step 1: Write the failing tests

Create `packages/server/src/lifecycle/__tests__/agent-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractModels, mergeAgentConfig, removeAgent } from "../agent-config.js";

const SAMPLE_CONFIG = {
  gateway: { port: 18789 },
  agents: {
    defaults: {
      model: { primary: "gpt-4o" },
      thinkingDefault: "full",
    },
    list: [
      {
        id: "main",
        model: { primary: "claude-sonnet-4-5-20250514" },
        thinkingDefault: "brief",
        tools: {
          allow: ["read", "search", "exec"],
          exec: { security: "allowlist", host: "localhost", ask: true, applyPatch: { workspaceOnly: true } },
        },
      },
      {
        id: "dev",
        model: { primary: "gpt-4o-mini" },
        tools: { allow: ["read", "search"] },
      },
    ],
  },
  channels: { feishu: { enabled: true } },
  bindings: [
    { agentId: "main", match: { channel: "feishu" } },
    { agentId: "dev", match: { channel: "slack" } },
  ],
};

describe("extractModels", () => {
  it("returns unique models from defaults + agents + common list", () => {
    const result = extractModels(SAMPLE_CONFIG);
    expect(result.defaultModel).toBe("gpt-4o");
    expect(result.models).toContain("gpt-4o");
    expect(result.models).toContain("claude-sonnet-4-5-20250514");
    expect(result.models).toContain("gpt-4o-mini");
    // Common models included
    expect(result.models).toContain("claude-haiku-4-5-20251001");
    // No duplicates
    const unique = new Set(result.models);
    expect(unique.size).toBe(result.models.length);
  });

  it("handles missing agents section gracefully", () => {
    const result = extractModels({ gateway: {} });
    expect(result.defaultModel).toBe("");
    expect(result.models.length).toBeGreaterThan(0); // common models
  });
});

describe("mergeAgentConfig", () => {
  it("updates defaults model and thinking", () => {
    const result = mergeAgentConfig(structuredClone(SAMPLE_CONFIG), {
      defaults: { model: "gpt-4o-mini", thinkingDefault: "disabled" },
      agents: [],
    });
    expect(result.agents.defaults.model.primary).toBe("gpt-4o-mini");
    expect(result.agents.defaults.thinkingDefault).toBe("disabled");
  });

  it("updates existing agent preserving unknown fields", () => {
    const result = mergeAgentConfig(structuredClone(SAMPLE_CONFIG), {
      defaults: { model: "gpt-4o", thinkingDefault: "full" },
      agents: [
        { id: "main", model: "gpt-4o", thinkingDefault: "full", toolsAllow: ["read"], execSecurity: "full", workspaceOnly: false },
      ],
    });
    const main = result.agents.list.find((a: any) => a.id === "main");
    expect(main.model.primary).toBe("gpt-4o");
    expect(main.thinkingDefault).toBe("full");
    expect(main.tools.allow).toEqual(["read"]);
    expect(main.tools.exec.security).toBe("full");
    expect(main.tools.exec.applyPatch.workspaceOnly).toBe(false);
    // Preserved unknown field
    expect(main.tools.exec.host).toBe("localhost");
    expect(main.tools.exec.ask).toBe(true);
  });

  it("adds new agent", () => {
    const result = mergeAgentConfig(structuredClone(SAMPLE_CONFIG), {
      defaults: { model: "gpt-4o", thinkingDefault: "full" },
      agents: [
        { id: "main", model: "claude-sonnet-4-5-20250514", thinkingDefault: "brief", toolsAllow: ["read", "search", "exec"], execSecurity: "allowlist", workspaceOnly: true },
        { id: "dev", model: "gpt-4o-mini", thinkingDefault: "", toolsAllow: ["read", "search"], execSecurity: "", workspaceOnly: false },
        { id: "newbot", model: "gpt-4o", thinkingDefault: "full", toolsAllow: ["*"], execSecurity: "full", workspaceOnly: false },
      ],
    });
    expect(result.agents.list).toHaveLength(3);
    const newbot = result.agents.list.find((a: any) => a.id === "newbot");
    expect(newbot).toBeDefined();
    expect(newbot.model.primary).toBe("gpt-4o");
    expect(newbot.tools.allow).toEqual(["*"]);
  });

  it("preserves non-agents config (gateway, channels, etc.)", () => {
    const result = mergeAgentConfig(structuredClone(SAMPLE_CONFIG), {
      defaults: { model: "gpt-4o", thinkingDefault: "full" },
      agents: [],
    });
    expect(result.gateway.port).toBe(18789);
    expect(result.channels.feishu.enabled).toBe(true);
  });

  it("creates agents section if missing", () => {
    const config = { gateway: { port: 18789 } };
    const result = mergeAgentConfig(config, {
      defaults: { model: "gpt-4o", thinkingDefault: "full" },
      agents: [{ id: "first", model: "gpt-4o", thinkingDefault: "", toolsAllow: [], execSecurity: "", workspaceOnly: false }],
    });
    expect(result.agents.defaults.model.primary).toBe("gpt-4o");
    expect(result.agents.list).toHaveLength(1);
  });
});

describe("removeAgent", () => {
  it("removes agent from list", () => {
    const result = removeAgent(structuredClone(SAMPLE_CONFIG), "dev");
    expect(result.agents.list).toHaveLength(1);
    expect(result.agents.list[0].id).toBe("main");
  });

  it("removes associated bindings", () => {
    const result = removeAgent(structuredClone(SAMPLE_CONFIG), "dev");
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].agentId).toBe("main");
  });

  it("throws if agent not found", () => {
    expect(() => removeAgent(structuredClone(SAMPLE_CONFIG), "nonexistent")).toThrow("Agent not found");
  });

  it("works when no bindings array exists", () => {
    const config = structuredClone(SAMPLE_CONFIG);
    delete (config as any).bindings;
    const result = removeAgent(config, "dev");
    expect(result.agents.list).toHaveLength(1);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/src/lifecycle/__tests__/agent-config.test.ts`
Expected: FAIL — module `../agent-config.js` does not exist

### Step 3: Write the implementation

Create `packages/server/src/lifecycle/agent-config.ts`:

```typescript
const COMMON_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "claude-sonnet-4-5-20250514",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
  "deepseek-chat",
  "deepseek-reasoner",
];

export interface AgentFormData {
  id: string;
  model: string;
  thinkingDefault: string;
  toolsAllow: string[];
  execSecurity: string;
  workspaceOnly: boolean;
}

export interface AgentConfigPayload {
  defaults: { model: string; thinkingDefault: string };
  agents: AgentFormData[];
}

export function extractModels(config: any): { models: string[]; defaultModel: string } {
  const agents = config?.agents || {};
  const defaultModel = agents.defaults?.model?.primary || "";
  const set = new Set<string>(COMMON_MODELS);
  if (defaultModel) set.add(defaultModel);
  for (const a of agents.list || []) {
    if (a.model?.primary) set.add(a.model.primary);
  }
  return { models: [...set], defaultModel };
}

export function mergeAgentConfig(config: any, payload: AgentConfigPayload): any {
  // Ensure agents section exists
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.list) config.agents.list = [];

  // Update defaults
  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  config.agents.defaults.model.primary = payload.defaults.model;
  config.agents.defaults.thinkingDefault = payload.defaults.thinkingDefault;

  // Build map of existing agents for preserving unknown fields
  const existingMap = new Map<string, any>();
  for (const a of config.agents.list) {
    existingMap.set(a.id, a);
  }

  // Rebuild agents.list
  config.agents.list = payload.agents.map((input) => {
    const existing = existingMap.get(input.id);
    if (existing) {
      // Update known fields, preserve the rest
      existing.model = { ...existing.model, primary: input.model };
      if (input.thinkingDefault) {
        existing.thinkingDefault = input.thinkingDefault;
      } else {
        delete existing.thinkingDefault;
      }
      if (!existing.tools) existing.tools = {};
      existing.tools.allow = input.toolsAllow;
      if (input.execSecurity) {
        if (!existing.tools.exec) existing.tools.exec = {};
        existing.tools.exec.security = input.execSecurity;
        if (!existing.tools.exec.applyPatch) existing.tools.exec.applyPatch = {};
        existing.tools.exec.applyPatch.workspaceOnly = input.workspaceOnly;
      }
      return existing;
    }
    // New agent
    const entry: any = { id: input.id, model: { primary: input.model } };
    if (input.thinkingDefault) entry.thinkingDefault = input.thinkingDefault;
    const tools: any = { allow: input.toolsAllow };
    if (input.execSecurity) {
      tools.exec = { security: input.execSecurity, applyPatch: { workspaceOnly: input.workspaceOnly } };
    }
    entry.tools = tools;
    return entry;
  });

  return config;
}

export function removeAgent(config: any, agentId: string): any {
  const list: any[] = config.agents?.list || [];
  const idx = list.findIndex((a) => a.id === agentId);
  if (idx === -1) throw new Error("Agent not found: " + agentId);
  list.splice(idx, 1);
  // Clean up bindings
  if (Array.isArray(config.bindings)) {
    config.bindings = config.bindings.filter((b: any) => b.agentId !== agentId);
  }
  return config;
}
```

### Step 4: Run tests to verify they pass

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/src/lifecycle/__tests__/agent-config.test.ts`
Expected: All 9 tests PASS

### Step 5: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/server/src/lifecycle/agent-config.ts packages/server/src/lifecycle/__tests__/agent-config.test.ts
git commit -m "feat: add agent-config helpers (extractModels, mergeAgentConfig, removeAgent)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Backend API — new agent endpoints in `lifecycle.ts`

**Files:**
- Modify: `packages/server/src/api/lifecycle.ts:11,101-129` (add import + 3 endpoints)
- Test: `packages/server/src/api/__tests__/lifecycle.test.ts` (add new describe blocks)

### Step 1: Write the failing tests

Append to `packages/server/src/api/__tests__/lifecycle.test.ts`, inside the outer `describe("Lifecycle API routes", ...)` block, before the closing `});`:

Add this mock at the top of the file (after the existing mocks around line 25):

```typescript
vi.mock("../../lifecycle/agent-config.js", () => ({
  extractModels: vi.fn(),
  mergeAgentConfig: vi.fn(),
  removeAgent: vi.fn(),
}));
```

Add this import (after the existing imports around line 44):

```typescript
import { extractModels, mergeAgentConfig, removeAgent } from "../../lifecycle/agent-config.js";
```

Add these describe blocks at the end (before the final `});`):

```typescript
  // ---- Agent Config ----

  describe("GET /:id/models", () => {
    it("returns model list from config", async () => {
      const mockConfig = { agents: { defaults: { model: { primary: "gpt-4o" } }, list: [] } };
      vi.mocked(readRemoteConfig).mockResolvedValue(mockConfig);
      vi.mocked(extractModels).mockReturnValue({ models: ["gpt-4o", "gpt-4o-mini"], defaultModel: "gpt-4o" });

      const res = await app.request("/lifecycle/ssh-1-main/models");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
      expect(data.defaultModel).toBe("gpt-4o");
      expect(extractModels).toHaveBeenCalledWith(mockConfig);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/models");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /:id/agents", () => {
    it("merges config and writes back", async () => {
      const originalConfig = { agents: { defaults: { model: { primary: "gpt-4o" } }, list: [] } };
      const mergedConfig = { agents: { defaults: { model: { primary: "gpt-4o-mini" } }, list: [{ id: "main" }] } };
      vi.mocked(readRemoteConfig).mockResolvedValue(originalConfig);
      vi.mocked(mergeAgentConfig).mockReturnValue(mergedConfig);
      vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

      const res = await app.request("/lifecycle/ssh-1-main/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaults: { model: "gpt-4o-mini", thinkingDefault: "full" },
          agents: [{ id: "main", model: "gpt-4o-mini", thinkingDefault: "full", toolsAllow: ["read"], execSecurity: "allowlist", workspaceOnly: true }],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(mergeAgentConfig).toHaveBeenCalledWith(originalConfig, expect.objectContaining({ defaults: { model: "gpt-4o-mini", thinkingDefault: "full" } }));
      expect(writeRemoteConfig).toHaveBeenCalledWith(mockExecutor, "~/.openclaw-main", mergedConfig);
    });

    it("creates snapshot after write", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({ agents: {} });
      vi.mocked(mergeAgentConfig).mockReturnValue({ agents: { list: [] } });
      vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

      await app.request("/lifecycle/ssh-1-main/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults: { model: "gpt-4o", thinkingDefault: "full" }, agents: [] }),
      });
      const snaps = db.prepare("SELECT * FROM config_snapshots WHERE instance_id = 'ssh-1-main'").all() as any[];
      expect(snaps.length).toBeGreaterThanOrEqual(1);
      expect(snaps[0].reason).toContain("agent config");
    });

    it("logs audit entry", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({ agents: {} });
      vi.mocked(mergeAgentConfig).mockReturnValue({ agents: { list: [] } });
      vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

      await app.request("/lifecycle/ssh-1-main/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults: { model: "gpt-4o", thinkingDefault: "full" }, agents: [] }),
      });
      const rows = db.prepare("SELECT * FROM operations WHERE type = 'lifecycle.agent-config'").all() as any[];
      expect(rows).toHaveLength(1);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults: {}, agents: [] }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /:id/agents/:agentId", () => {
    it("removes agent and writes config back", async () => {
      const originalConfig = { agents: { list: [{ id: "main" }, { id: "dev" }] } };
      const afterRemove = { agents: { list: [{ id: "main" }] } };
      vi.mocked(readRemoteConfig).mockResolvedValue(originalConfig);
      vi.mocked(removeAgent).mockReturnValue(afterRemove);
      vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

      const res = await app.request("/lifecycle/ssh-1-main/agents/dev", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(removeAgent).toHaveBeenCalledWith(originalConfig, "dev");
      expect(writeRemoteConfig).toHaveBeenCalledWith(mockExecutor, "~/.openclaw-main", afterRemove);
    });

    it("returns 404 when agent not found", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({ agents: { list: [] } });
      vi.mocked(removeAgent).mockImplementation(() => { throw new Error("Agent not found: ghost"); });

      const res = await app.request("/lifecycle/ssh-1-main/agents/ghost", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/agents/main", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("creates snapshot and audit log", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({ agents: { list: [{ id: "main" }] } });
      vi.mocked(removeAgent).mockReturnValue({ agents: { list: [] } });
      vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

      await app.request("/lifecycle/ssh-1-main/agents/main", { method: "DELETE" });
      const snaps = db.prepare("SELECT * FROM config_snapshots WHERE instance_id = 'ssh-1-main'").all() as any[];
      expect(snaps.length).toBeGreaterThanOrEqual(1);
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'lifecycle.agent-delete'").all() as any[];
      expect(ops).toHaveLength(1);
    });
  });
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/src/api/__tests__/lifecycle.test.ts`
Expected: FAIL — new endpoints return 404 (no routes defined)

### Step 3: Implement the endpoints

Edit `packages/server/src/api/lifecycle.ts`:

**Add import** at line 12 (after the SnapshotStore import):

```typescript
import { extractModels, mergeAgentConfig, removeAgent } from "../lifecycle/agent-config.js";
```

**Add the `config_snapshots` table init** in the function body (after `snapshots.init();` at line 20):

_(No change needed — SnapshotStore already calls init())_

**Add 3 new route handlers** after the `PUT /:id/config-file` block (after line 129, before the Install/Upgrade section):

```typescript
  // --- Agent config (structured) ---

  app.get("/:id/models", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const config = await readRemoteConfig(exec, configDir);
    return c.json(extractModels(config));
  });

  app.put("/:id/agents", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const payload = await c.req.json();
    try {
      const config = await readRemoteConfig(exec, configDir);
      const merged = mergeAgentConfig(config, payload);
      await writeRemoteConfig(exec, configDir, merged);
      snapshots.create(id, JSON.stringify(merged), "agent config update");
      auditLog(db, c, "lifecycle.agent-config", "Agent config updated", id);
      return c.json({ ok: true });
    } catch (err: any) {
      auditLog(db, c, "lifecycle.agent-config", `FAILED: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });

  app.delete("/:id/agents/:agentId", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const agentId = c.req.param("agentId");
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    try {
      const config = await readRemoteConfig(exec, configDir);
      const updated = removeAgent(config, agentId);
      await writeRemoteConfig(exec, configDir, updated);
      snapshots.create(id, JSON.stringify(updated), `deleted agent: ${agentId}`);
      auditLog(db, c, "lifecycle.agent-delete", `Deleted agent ${agentId}`, id);
      return c.json({ ok: true });
    } catch (err: any) {
      if (err.message.includes("not found")) return c.json({ error: err.message }, 404);
      auditLog(db, c, "lifecycle.agent-delete", `FAILED: ${err.message}`, id);
      return c.json({ error: err.message }, 500);
    }
  });
```

### Step 4: Update test setup for snapshot table

In `packages/server/src/api/__tests__/lifecycle.test.ts`, inside `beforeEach`, after the `operations` table CREATE, add:

```typescript
    db.exec(`
      CREATE TABLE IF NOT EXISTS config_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
```

### Step 5: Run tests to verify they pass

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/src/api/__tests__/lifecycle.test.ts`
Expected: All tests PASS (existing 25 + new 10 = 35)

### Step 6: Run full backend test suite

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/`
Expected: All tests PASS

### Step 7: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/server/src/api/lifecycle.ts packages/server/src/api/__tests__/lifecycle.test.ts
git commit -m "feat: add GET /models, PUT /agents, DELETE /agents/:agentId endpoints

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — RestartDialog component

**Files:**
- Create: `packages/web/src/components/RestartDialog.tsx`

### Step 1: Create the component

Create `packages/web/src/components/RestartDialog.tsx`:

```tsx
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { post } from "../lib/api";

interface RestartDialogProps {
  instanceId: string;
  open: boolean;
  onClose: () => void;
}

export function RestartDialog({ instanceId, open, onClose }: RestartDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const doRestart = async () => {
    setBusy(true);
    setError("");
    try {
      await post(`/lifecycle/${instanceId}/restart`);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-s1 border border-edge rounded-card p-6 shadow-card max-w-sm w-full">
        <h3 className="text-lg font-semibold text-ink mb-2">Config Saved</h3>
        <p className="text-sm text-ink-2 mb-4">
          Configuration saved successfully. Restart the instance to apply changes?
        </p>
        {error && <p className="text-sm text-danger mb-3">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-ink-3 hover:text-ink rounded"
          >
            Later
          </button>
          <button
            onClick={doRestart}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded bg-brand text-white hover:bg-brand-light disabled:opacity-40"
          >
            <RotateCcw size={14} />
            {busy ? "Restarting..." : "Restart Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/web/src/components/RestartDialog.tsx
git commit -m "feat: add RestartDialog component for post-save restart prompt

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — TemplateApplyModal component

**Files:**
- Create: `packages/web/src/components/TemplateApplyModal.tsx`

### Step 1: Create the component

Create `packages/web/src/components/TemplateApplyModal.tsx`:

```tsx
import { useState, useEffect } from "react";
import { Shield, Check, X } from "lucide-react";
import { get } from "../lib/api";

interface Template {
  id: string;
  name: string;
  description: string;
  preset: boolean;
  config: {
    toolsAllow: string[];
    execSecurity: string;
    workspaceOnly: boolean;
  };
}

interface TemplateApplyModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (config: Template["config"]) => void;
  currentValues: {
    toolsAllow: string[];
    execSecurity: string;
    workspaceOnly: boolean;
  };
}

export function TemplateApplyModal({ open, onClose, onApply, currentValues }: TemplateApplyModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);

  useEffect(() => {
    if (open) {
      get<Template[]>("/instances/templates").then(setTemplates).catch(() => {});
      setSelected(null);
    }
  }, [open]);

  if (!open) return null;

  const diff = selected ? [
    { field: "Tools Allow", before: currentValues.toolsAllow.join(", ") || "(none)", after: selected.config.toolsAllow.join(", ") },
    { field: "Exec Security", before: currentValues.execSecurity || "(none)", after: selected.config.execSecurity },
    { field: "Workspace Only", before: String(currentValues.workspaceOnly), after: String(selected.config.workspaceOnly) },
  ] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-s1 border border-edge rounded-card shadow-card max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h3 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Shield size={18} /> Apply Permission Template
          </h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className={`w-full text-left p-3 rounded border ${
                selected?.id === t.id ? "border-brand bg-brand/5" : "border-edge hover:border-ink-3"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{t.name}</span>
                {t.preset && <span className="px-1.5 py-0.5 text-xs rounded bg-cyan-dim text-cyan">preset</span>}
              </div>
              <p className="text-xs text-ink-3 mt-0.5">{t.description}</p>
            </button>
          ))}
        </div>

        {selected && (
          <div className="border-t border-edge p-4">
            <h4 className="text-sm font-medium text-ink mb-2">Preview Changes</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-3 text-xs">
                  <th className="text-left py-1">Field</th>
                  <th className="text-left py-1">Current</th>
                  <th className="text-left py-1">After</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.field} className={d.before !== d.after ? "text-warn" : "text-ink-2"}>
                    <td className="py-1">{d.field}</td>
                    <td className="py-1 font-mono text-xs">{d.before}</td>
                    <td className="py-1 font-mono text-xs">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end mt-3">
              <button
                onClick={() => { onApply(selected.config); onClose(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm rounded bg-brand text-white hover:bg-brand-light"
              >
                <Check size={14} /> Apply to Form
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/web/src/components/TemplateApplyModal.tsx
git commit -m "feat: add TemplateApplyModal with diff preview

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — AgentForm component

**Files:**
- Create: `packages/web/src/components/AgentForm.tsx`

### Step 1: Create the component

Create `packages/web/src/components/AgentForm.tsx`:

```tsx
import { useState } from "react";
import { X, Plus, Shield } from "lucide-react";

export interface AgentFormValues {
  id: string;
  model: string;
  thinkingDefault: string;
  toolsAllow: string[];
  execSecurity: string;
  workspaceOnly: boolean;
}

interface AgentFormProps {
  values: AgentFormValues;
  onChange: (values: AgentFormValues) => void;
  models: string[];
  defaultModel: string;
  defaultThinking: string;
  isNew: boolean;
  onApplyTemplate: () => void;
}

const THINKING_OPTIONS = [
  { value: "", label: "Inherit default" },
  { value: "full", label: "Full" },
  { value: "brief", label: "Brief" },
  { value: "disabled", label: "Disabled" },
];

const EXEC_SECURITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "allowlist", label: "Allowlist" },
  { value: "full", label: "Full" },
  { value: "disabled", label: "Disabled" },
];

export function AgentForm({ values, onChange, models, defaultModel, defaultThinking, isNew, onApplyTemplate }: AgentFormProps) {
  const [toolInput, setToolInput] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const set = <K extends keyof AgentFormValues>(key: K, val: AgentFormValues[K]) =>
    onChange({ ...values, [key]: val });

  const addTool = () => {
    const tool = toolInput.trim();
    if (tool && !values.toolsAllow.includes(tool)) {
      set("toolsAllow", [...values.toolsAllow, tool]);
    }
    setToolInput("");
  };

  const removeTool = (tool: string) => {
    set("toolsAllow", values.toolsAllow.filter((t) => t !== tool));
  };

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes((modelSearch || values.model).toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Agent ID */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Agent ID</label>
        {isNew ? (
          <input
            value={values.id}
            onChange={(e) => set("id", e.target.value)}
            placeholder="e.g. my-agent"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        ) : (
          <div className="px-3 py-2 text-sm bg-s2/50 border border-edge rounded text-ink-2 font-mono">{values.id}</div>
        )}
      </div>

      {/* Model combobox */}
      <div className="relative">
        <label className="block text-xs text-ink-3 mb-1">
          Model
          {!values.model && defaultModel && <span className="ml-1 text-ink-3">(default: {defaultModel})</span>}
        </label>
        <input
          value={modelSearch || values.model}
          onChange={(e) => { setModelSearch(e.target.value); set("model", e.target.value); setShowModelDropdown(true); }}
          onFocus={() => setShowModelDropdown(true)}
          onBlur={() => setTimeout(() => setShowModelDropdown(false), 200)}
          placeholder={defaultModel || "Select model..."}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
        />
        {showModelDropdown && filteredModels.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-s1 border border-edge rounded shadow-card max-h-48 overflow-auto">
            {filteredModels.map((m) => (
              <button
                key={m}
                onMouseDown={() => { set("model", m); setModelSearch(""); setShowModelDropdown(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-s2 text-ink"
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thinking */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">
          Thinking Level
          {!values.thinkingDefault && defaultThinking && <span className="ml-1">(default: {defaultThinking})</span>}
        </label>
        <select
          value={values.thinkingDefault}
          onChange={(e) => set("thinkingDefault", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {THINKING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Tools Allow */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Allowed Tools</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.toolsAllow.map((tool) => (
            <span key={tool} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {tool}
              <button onClick={() => removeTool(tool)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTool(); } }}
            placeholder="Add tool name..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={addTool} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Exec Security */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Exec Security</label>
        <select
          value={values.execSecurity}
          onChange={(e) => set("execSecurity", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {EXEC_SECURITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Workspace Only */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.workspaceOnly}
          onChange={(e) => set("workspaceOnly", e.target.checked)}
          className="rounded border-edge"
        />
        <label className="text-sm text-ink">Workspace Only</label>
      </div>

      {/* Apply Template button */}
      <button
        onClick={onApplyTemplate}
        className="flex items-center gap-1.5 text-sm text-brand hover:text-brand-light"
      >
        <Shield size={14} /> Apply Permission Template
      </button>
    </div>
  );
}
```

### Step 2: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/web/src/components/AgentForm.tsx
git commit -m "feat: add AgentForm component with model combobox and tool tagger

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — AgentsTab in Instance.tsx

**Files:**
- Modify: `packages/web/src/pages/Instance.tsx`

### Step 1: Add imports

At the top of `Instance.tsx` (line 3), add to the lucide-react imports:

```
Users, Plus, Trash2
```

Below line 5, add:

```typescript
import { del } from "../lib/api";
import { AgentForm, type AgentFormValues } from "../components/AgentForm";
import { TemplateApplyModal } from "../components/TemplateApplyModal";
import { RestartDialog } from "../components/RestartDialog";
```

### Step 2: Update the Tab type

Change line 21 from:

```typescript
type Tab = "overview" | "sessions" | "config" | "security" | "control";
```

to:

```typescript
type Tab = "overview" | "sessions" | "config" | "security" | "agents" | "control";
```

### Step 3: Create the AgentsTab component

Add this function **before** the `ControlTab` function (before line 381):

```tsx
function AgentsTab({ inst }: { inst: InstanceInfo }) {
  const [config, setConfig] = useState<any>(null);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultThinking, setDefaultThinking] = useState("");
  const [agents, setAgents] = useState<AgentFormValues[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [cfg, modelData] = await Promise.all([
        get<any>(`/lifecycle/${inst.id}/config-file`),
        get<{ models: string[]; defaultModel: string }>(`/lifecycle/${inst.id}/models`),
      ]);
      setConfig(cfg);
      setModels(modelData.models);
      setDefaultModel(modelData.defaultModel);

      const agentsSection = cfg?.agents || {};
      const defaults = agentsSection.defaults || {};
      setDefaultThinking(defaults.thinkingDefault || "");
      setDefaultModel(defaults.model?.primary || "");

      const list: any[] = agentsSection.list || [];
      setAgents(list.map((a) => ({
        id: a.id,
        model: a.model?.primary || "",
        thinkingDefault: a.thinkingDefault || "",
        toolsAllow: a.tools?.allow || [],
        execSecurity: a.tools?.exec?.security || "",
        workspaceOnly: a.tools?.exec?.applyPatch?.workspaceOnly || false,
      })));
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(); }, [inst.id]);

  const selected = agents.find((a) => a.id === selectedId) || null;

  const updateAgent = (values: AgentFormValues) => {
    setAgents((prev) => prev.map((a) => a.id === values.id ? values : a));
  };

  const addNewAgent = () => {
    const newAgent: AgentFormValues = {
      id: "",
      model: "",
      thinkingDefault: "",
      toolsAllow: [],
      execSecurity: "",
      workspaceOnly: false,
    };
    setAgents((prev) => [...prev, newAgent]);
    setSelectedId("");
    setIsNew(true);
  };

  const saveAll = async () => {
    if (isNew && agents.some((a) => !a.id)) {
      setError("Agent ID is required");
      return;
    }
    // Check for duplicate IDs
    const ids = agents.map((a) => a.id);
    if (new Set(ids).size !== ids.length) {
      setError("Duplicate agent IDs detected");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await put(`/lifecycle/${inst.id}/agents`, {
        defaults: { model: defaultModel, thinkingDefault: defaultThinking },
        agents,
      });
      setIsNew(false);
      setShowRestartDialog(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async (agentId: string) => {
    setBusy(true);
    setError("");
    try {
      await del(`/lifecycle/${inst.id}/agents/${agentId}`);
      setShowDeleteConfirm(null);
      if (selectedId === agentId) setSelectedId(null);
      await fetchData();
      setShowRestartDialog(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (templateConfig: { toolsAllow: string[]; execSecurity: string; workspaceOnly: boolean }) => {
    if (!selected) return;
    updateAgent({
      ...selected,
      toolsAllow: templateConfig.toolsAllow,
      execSecurity: templateConfig.execSecurity,
      workspaceOnly: templateConfig.workspaceOnly,
    });
  };

  return (
    <div className="space-y-4">
      {/* Global Defaults */}
      <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
        <h3 className="text-sm font-semibold text-ink-2 mb-3">Global Defaults</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-ink-3 mb-1">Default Model</label>
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-3 mb-1">Default Thinking</label>
            <select
              value={defaultThinking}
              onChange={(e) => setDefaultThinking(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
            >
              <option value="">Not set</option>
              <option value="full">Full</option>
              <option value="brief">Brief</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Agent list + form */}
      <div className="bg-s1 border border-edge rounded-card shadow-card flex min-h-[400px]">
        {/* Sidebar */}
        <div className="w-48 border-r border-edge">
          <div className="p-3 border-b border-edge flex items-center justify-between">
            <span className="text-sm font-semibold text-ink-2">Agents</span>
            <button onClick={addNewAgent} className="text-brand hover:text-brand-light"><Plus size={16} /></button>
          </div>
          <div className="divide-y divide-edge">
            {agents.map((a) => (
              <button
                key={a.id || "__new__"}
                onClick={() => { setSelectedId(a.id); setIsNew(!a.id); }}
                className={`w-full text-left px-3 py-2 text-sm ${
                  selectedId === a.id ? "bg-brand/10 text-brand" : "text-ink hover:bg-s2"
                }`}
              >
                {a.id || "(new agent)"}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 p-4">
          {selected ? (
            <>
              <AgentForm
                values={selected}
                onChange={updateAgent}
                models={models}
                defaultModel={defaultModel}
                defaultThinking={defaultThinking}
                isNew={isNew}
                onApplyTemplate={() => setShowTemplateModal(true)}
              />
              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-edge">
                <button
                  onClick={saveAll}
                  disabled={busy}
                  className="px-4 py-2 text-sm rounded bg-brand text-white hover:bg-brand-light disabled:opacity-40"
                >
                  {busy ? "Saving..." : "Save All"}
                </button>
                {!isNew && (
                  <button
                    onClick={() => setShowDeleteConfirm(selected.id)}
                    className="flex items-center gap-1 px-3 py-2 text-sm text-danger hover:text-danger/80"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                )}
                {error && <span className="text-sm text-danger">{error}</span>}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-ink-3 text-sm">
              Select an agent or create a new one
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-s1 border border-edge rounded-card p-6 shadow-card max-w-sm w-full">
            <h3 className="text-lg font-semibold text-ink mb-2">Delete Agent</h3>
            <p className="text-sm text-ink-2 mb-4">
              Delete agent <strong>{showDeleteConfirm}</strong>? This will also remove associated bindings.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                onClick={() => deleteAgent(showDeleteConfirm)}
                disabled={busy}
                className="px-4 py-2 text-sm rounded bg-danger text-white hover:bg-danger/80 disabled:opacity-40"
              >
                {busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <TemplateApplyModal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onApply={applyTemplate}
        currentValues={{
          toolsAllow: selected?.toolsAllow || [],
          execSecurity: selected?.execSecurity || "",
          workspaceOnly: selected?.workspaceOnly || false,
        }}
      />

      <RestartDialog
        instanceId={inst.id}
        open={showRestartDialog}
        onClose={() => setShowRestartDialog(false)}
      />
    </div>
  );
}
```

### Step 4: Add the tab to the tabs array

In the tabs array (around line 744-750), add after the security entry:

```typescript
    { key: "agents", label: `Agents (${inst.agents.length})` },
```

### Step 5: Add the tab content

In the tab content rendering section (around line 778-782), add after the security line:

```typescript
        {activeTab === "agents" && <AgentsTab inst={inst} />}
```

### Step 6: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/web/src/pages/Instance.tsx
git commit -m "feat: add AgentsTab with CRUD, global defaults, template apply, restart dialog

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — Security.tsx template "Apply" button

**Files:**
- Modify: `packages/web/src/pages/Security.tsx:90-117`

### Step 1: Add useNavigate import

At line 1 of Security.tsx, update the react-router-dom import. Currently the file doesn't import from react-router-dom. Add:

```typescript
import { useNavigate } from "react-router-dom";
```

### Step 2: Add navigate + Apply button to TemplateManager

Inside the `TemplateManager` function, add at the top:

```typescript
  const { instances } = useInstances();
  const navigate = useNavigate();
  const connectedInstances = instances.filter((i) => i.connection.status === "connected");
  const [applyTarget, setApplyTarget] = useState<{ templateId: string; instanceId: string } | null>(null);
```

Update the template list rendering (inside the `.map((t) => ...)` block, around line 94-116). Add an "Apply" button next to each template's delete button:

In the `<div className="flex-1">` sibling area, after the `{!t.preset && ...}` delete button block, add:

```tsx
            {connectedInstances.length > 0 && (
              <div className="relative">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      navigate(`/instance/${e.target.value}?tab=agents&applyTemplate=${t.id}`);
                    }
                  }}
                  className="px-2 py-1 text-xs bg-s2 border border-edge rounded text-ink cursor-pointer"
                >
                  <option value="" disabled>Apply to...</option>
                  {connectedInstances.map((inst) => (
                    <option key={inst.id} value={inst.id}>{inst.connection.label || inst.id}</option>
                  ))}
                </select>
              </div>
            )}
```

### Step 3: Handle `?tab=agents&applyTemplate=` in Instance.tsx

In the Instance page component (around line 729), add:

```typescript
  const [searchParams] = useSearchParams();
```

Add `useSearchParams` to the react-router-dom import at top.

After `const [activeTab, setActiveTab] = useState<Tab>("overview");` add:

```typescript
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab;
    if (tab && ["overview", "sessions", "config", "security", "agents", "control"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);
```

### Step 4: Commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add packages/web/src/pages/Security.tsx packages/web/src/pages/Instance.tsx
git commit -m "feat: add 'Apply to...' button in Security templates, deep-link to AgentsTab

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Full integration test

### Step 1: Run all backend tests

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npx vitest run packages/server/`
Expected: All tests PASS

### Step 2: Run frontend build

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && cd packages/web && npx tsc --noEmit`
Expected: No type errors

### Step 3: Run dev server and verify manually

Run: `cd /Users/kris/proj/openclaw/ClawSafeMng && npm run dev`

Verify:
1. Navigate to an instance detail → "Agents" tab appears
2. Global Defaults section shows model and thinking
3. Agent list shows existing agents
4. Selecting an agent shows the form with current values
5. "+" creates a new agent form
6. "Apply Permission Template" opens the modal
7. "Save All" writes config and shows restart dialog
8. "Delete" prompts confirmation and removes agent
9. In Security page, templates have "Apply to..." dropdown

### Step 4: Final commit

```bash
cd /Users/kris/proj/openclaw/ClawSafeMng
git add -A
git commit -m "feat: complete agent config management — CRUD, defaults, templates, restart dialog

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Backend helpers | `lifecycle/agent-config.ts` | 9 unit tests |
| 2 | API endpoints | `api/lifecycle.ts` | 10 integration tests |
| 3 | RestartDialog | `components/RestartDialog.tsx` | — |
| 4 | TemplateApplyModal | `components/TemplateApplyModal.tsx` | — |
| 5 | AgentForm | `components/AgentForm.tsx` | — |
| 6 | AgentsTab | `pages/Instance.tsx` | — |
| 7 | Security Apply button | `pages/Security.tsx` + Instance deep-link | — |
| 8 | Integration test | Full suite | All passing |
