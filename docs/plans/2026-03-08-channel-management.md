# Channel Management Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade channel management from basic status badges to full account-level detail view, configuration editing, and operational controls (probe, logout, enable/disable).

**Architecture:** Two-level view — top-level Channels page for cross-instance summary + Instance detail Channels Tab for per-instance deep management. Backend extends lifecycle API with 4 new endpoints that call Gateway RPCs and read/write `openclaw.json`. Channel config editing reuses the existing readRemoteConfig/writeRemoteConfig/snapshot/RestartDialog pattern established by Agent config management.

**Tech Stack:** TypeScript, Hono (backend), React + Tailwind (frontend), ws (Gateway RPC), ssh2 (remote config)

---

### Task 1: Upgrade Data Types

**Files:**
- Modify: `packages/server/src/gateway/types.ts`

**Context:** The current `ChannelInfo` type has only 5 fields (type, accountId, enabled, running, configured). The Gateway `channels.status` RPC returns much richer data including per-account snapshots with connection state, timestamps, error info, and policies. We need new types to represent this.

**Step 1: Add new types to types.ts**

Add after the existing `ChannelInfo` interface (line 51):

```typescript
export interface ChannelAccountInfo {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  running: boolean;
  connected: boolean;
  restartPending?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  busy?: boolean;
  activeRuns?: number;
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: (string | number)[];
  groupAllowFrom?: (string | number)[];
}

export interface ChannelDetail {
  type: string;
  label: string;
  defaultAccountId?: string;
  accounts: ChannelAccountInfo[];
}

export interface ChannelStatusResponse {
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channels: ChannelDetail[];
  defaultAccountIds: Record<string, string>;
}
```

Keep the existing `ChannelInfo` interface — it's still used by `InstanceInfo.channels` for the lightweight summary in Dashboard/OverviewTab.

**Step 2: Commit**

```bash
git add packages/server/src/gateway/types.ts
git commit -m "feat(channels): add ChannelAccountInfo, ChannelDetail, ChannelStatusResponse types"
```

---

### Task 2: Upgrade GatewayClient

**Files:**
- Modify: `packages/server/src/gateway/client.ts`

**Context:** The current `fetchChannels()` method (line 218) only extracts the basic `channels` array from the RPC response. We need a new method that returns the full response including `channelAccounts`, `channelOrder`, `channelLabels`, and `channelDefaultAccountId`. We also need `channelLogout()` and `channelProbe()` methods.

**Step 1: Add `fetchChannelDetails()` method**

Add after `fetchChannels()` (after line 227):

```typescript
async fetchChannelDetails(probe = false): Promise<ChannelStatusResponse> {
  const r = await this.rpc("channels.status", probe ? { probe: true, timeoutMs: 10_000 } : {});
  const channelOrder: string[] = r?.channelOrder || [];
  const channelLabels: Record<string, string> = r?.channelLabels || {};
  const channelAccounts: Record<string, any[]> = r?.channelAccounts || {};
  const channelDefaultAccountId: Record<string, string> = r?.channelDefaultAccountId || {};

  const channels: ChannelDetail[] = channelOrder.map((type) => ({
    type,
    label: channelLabels[type] || type,
    defaultAccountId: channelDefaultAccountId[type],
    accounts: (channelAccounts[type] || []).map((a: any) => ({
      accountId: a.accountId || "default",
      name: a.name,
      enabled: a.enabled ?? true,
      configured: a.configured ?? false,
      running: a.running ?? false,
      connected: a.connected ?? false,
      restartPending: a.restartPending,
      reconnectAttempts: a.reconnectAttempts,
      lastConnectedAt: a.lastConnectedAt,
      lastError: a.lastError,
      lastStartAt: a.lastStartAt,
      lastStopAt: a.lastStopAt,
      lastInboundAt: a.lastInboundAt,
      lastOutboundAt: a.lastOutboundAt,
      busy: a.busy,
      activeRuns: a.activeRuns,
      dmPolicy: a.dmPolicy,
      groupPolicy: a.groupPolicy,
      allowFrom: a.allowFrom,
      groupAllowFrom: a.groupAllowFrom,
    })),
  })).filter((ch) => ch.accounts.length > 0);

  return {
    channelOrder,
    channelLabels,
    channels,
    defaultAccountIds: channelDefaultAccountId,
  };
}
```

**Step 2: Add `channelLogout()` method**

Add after `fetchChannelDetails()`:

```typescript
async channelLogout(channel: string, accountId?: string): Promise<any> {
  return this.rpc("channels.logout", { channel, ...(accountId ? { accountId } : {}) });
}
```

**Step 3: Add import for new types**

Update the import at the top of client.ts (line 4-15) to include the new types:

```typescript
import type {
  GatewayConnection,
  InstanceInfo,
  HealthStatus,
  AgentInfo,
  ChannelInfo,
  ChannelDetail,
  ChannelStatusResponse,
  ChannelAccountInfo,
  SessionSummary,
  SkillInfo,
  SecurityAuditItem,
  ToolInfo,
  Binding,
} from "./types.js";
```

**Step 4: Commit**

```bash
git add packages/server/src/gateway/client.ts
git commit -m "feat(channels): add fetchChannelDetails, channelLogout to GatewayClient"
```

---

### Task 3: Channel Config Merge Logic

**Files:**
- Create: `packages/server/src/lifecycle/channel-config.ts`
- Create: `packages/server/src/lifecycle/__tests__/channel-config.test.ts`

**Context:** We need a function that takes the current openclaw.json config and a channel account config update, then merges the update into the correct location in the config tree. The config structure is `channels.<type>.accounts.<accountId>.{ dmPolicy, groupPolicy, enabled, ... }`. If the account config is at the channel root level (no `accounts` map), we merge there instead.

**Step 1: Write failing tests**

Create `packages/server/src/lifecycle/__tests__/channel-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeChannelAccountConfig } from "../channel-config.js";

describe("mergeChannelAccountConfig", () => {
  it("merges config into channel.accounts.<id>", () => {
    const config = {
      channels: {
        telegram: {
          accounts: {
            default: { enabled: true, dmPolicy: "open" },
          },
        },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
      allowFrom: ["user1"],
    });
    expect(result.channels.telegram.accounts.default.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.accounts.default.allowFrom).toEqual(["user1"]);
    expect(result.channels.telegram.accounts.default.enabled).toBe(true);
  });

  it("merges config at channel root when no accounts map", () => {
    const config = {
      channels: {
        telegram: { enabled: true, dmPolicy: "open" },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
    });
    expect(result.channels.telegram.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.enabled).toBe(true);
  });

  it("creates accounts map if accountId is not default", () => {
    const config = {
      channels: {
        telegram: { enabled: true },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "bot2", {
      dmPolicy: "disabled",
    });
    expect(result.channels.telegram.accounts.bot2.dmPolicy).toBe("disabled");
  });

  it("preserves other channels", () => {
    const config = {
      channels: {
        telegram: { accounts: { default: { dmPolicy: "open" } } },
        feishu: { accounts: { abc: { dmPolicy: "allowlist" } } },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "disabled",
    });
    expect(result.channels.feishu.accounts.abc.dmPolicy).toBe("allowlist");
  });

  it("only merges allowed fields", () => {
    const config = {
      channels: {
        telegram: { accounts: { default: { botToken: "secret123", dmPolicy: "open" } } },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
      botToken: "hacked",
    } as any);
    expect(result.channels.telegram.accounts.default.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.accounts.default.botToken).toBe("secret123");
  });

  it("throws for unknown channel type", () => {
    const config = { channels: {} };
    expect(() =>
      mergeChannelAccountConfig(config, "nonexistent", "default", { dmPolicy: "open" })
    ).toThrow("Channel not found");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/lifecycle/__tests__/channel-config.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `mergeChannelAccountConfig`**

Create `packages/server/src/lifecycle/channel-config.ts`:

```typescript
const ALLOWED_FIELDS = new Set([
  "enabled",
  "dmPolicy",
  "groupPolicy",
  "allowFrom",
  "groupAllowFrom",
  "historyLimit",
  "dmHistoryLimit",
  "textChunkLimit",
  "chunkMode",
  "blockStreaming",
]);

export interface ChannelAccountConfigUpdate {
  enabled?: boolean;
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: (string | number)[];
  groupAllowFrom?: (string | number)[];
  historyLimit?: number;
  dmHistoryLimit?: number;
  textChunkLimit?: number;
  chunkMode?: string;
  blockStreaming?: boolean;
}

/**
 * Merge a channel account config update into the full openclaw.json config.
 * Only merges allowed fields (policies + messaging behavior). Credential fields are ignored.
 */
export function mergeChannelAccountConfig(
  config: any,
  channel: string,
  accountId: string,
  update: ChannelAccountConfigUpdate,
): any {
  const channels = config?.channels || {};
  const chConfig = channels[channel];
  if (!chConfig) throw new Error(`Channel not found: ${channel}`);

  const result = JSON.parse(JSON.stringify(config));
  const chResult = result.channels[channel];

  // Filter to allowed fields only
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (ALLOWED_FIELDS.has(key)) filtered[key] = value;
  }

  // Determine merge target: accounts.<id> if it exists, or channel root for "default"
  if (chResult.accounts?.[accountId]) {
    Object.assign(chResult.accounts[accountId], filtered);
  } else if (accountId === "default" && !chResult.accounts) {
    // No accounts map and accountId is "default" — merge at channel root
    Object.assign(chResult, filtered);
  } else {
    // Create accounts map with new entry
    if (!chResult.accounts) chResult.accounts = {};
    chResult.accounts[accountId] = { ...filtered };
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/lifecycle/__tests__/channel-config.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add packages/server/src/lifecycle/channel-config.ts packages/server/src/lifecycle/__tests__/channel-config.test.ts
git commit -m "feat(channels): add mergeChannelAccountConfig with field allowlist"
```

---

### Task 4: Backend Channel Endpoints

**Files:**
- Modify: `packages/server/src/api/lifecycle.ts`
- Modify: `packages/server/src/api/__tests__/lifecycle.test.ts`

**Context:** Add 4 new endpoints to the lifecycle router. These follow the same pattern as the existing agent config endpoints: get instance → get executor/gateway client → call RPC or read/write config → audit log.

The key difference: channel endpoints need the GatewayClient directly (for RPC calls), not just the executor. The `manager.get(id)` returns the instance info, but we need the GatewayClient. Check how the existing code gets the gateway client — it should be accessible through the instance manager or stored alongside.

**Important:** Look at how `fetchChannelDetails()` and `channelLogout()` are called — they need the GatewayClient instance. The `manager` has a method to get gateway clients (check `InstanceManager` class).

**Step 1: Add channel endpoints to lifecycle.ts**

Add these 4 endpoints in `lifecycle.ts`, after the existing agents endpoints (after the `DELETE /:id/agents/:agentId` handler). Add the import for `mergeChannelAccountConfig` at the top.

```typescript
// At top, add import:
import { mergeChannelAccountConfig } from "../lifecycle/channel-config.js";

// --- Channel management ---

app.get("/:id/channels", async (c) => {
  const id = c.req.param("id");
  const inst = manager.get(id);
  if (!inst) return c.json({ error: "instance not found" }, 404);
  const client = manager.getClient(id);
  if (!client) return c.json({ error: "not connected" }, 502);
  try {
    const details = await client.fetchChannelDetails(false);
    return c.json(details);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/:id/channels/probe", async (c) => {
  const id = c.req.param("id");
  const inst = manager.get(id);
  if (!inst) return c.json({ error: "instance not found" }, 404);
  const client = manager.getClient(id);
  if (!client) return c.json({ error: "not connected" }, 502);
  try {
    const details = await client.fetchChannelDetails(true);
    return c.json(details);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/:id/channels/logout", async (c) => {
  const id = c.req.param("id");
  const inst = manager.get(id);
  if (!inst) return c.json({ error: "instance not found" }, 404);
  const client = manager.getClient(id);
  if (!client) return c.json({ error: "not connected" }, 502);
  const { channel, accountId } = await c.req.json();
  if (!channel) return c.json({ error: "channel required" }, 400);
  try {
    const result = await client.channelLogout(channel, accountId);
    auditLog(db, c, "lifecycle.channel-logout", `Logout ${channel}/${accountId || "default"}`, id);
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put("/:id/channels/config", async (c) => {
  const id = c.req.param("id");
  if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
  const profile = profileFromInstanceId(id);
  const configDir = getConfigDir(profile);
  const exec = getExecutor(id, hostStore);
  const { channel, accountId, config: update } = await c.req.json();
  if (!channel) return c.json({ error: "channel required" }, 400);
  try {
    const config = await readRemoteConfig(exec, configDir);
    const merged = mergeChannelAccountConfig(config, channel, accountId || "default", update);
    await writeRemoteConfig(exec, configDir, merged);
    try { snapshots.create(id, JSON.stringify(merged), "channel config update"); } catch { /* best-effort */ }
    auditLog(db, c, "lifecycle.channel-config", `Updated ${channel}/${accountId || "default"}`, id);
    return c.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes("not found")) return c.json({ error: err.message }, 404);
    auditLog(db, c, "lifecycle.channel-config", `FAILED: ${err.message}`, id);
    return c.json({ error: err.message }, 500);
  }
});
```

**Step 2: Check InstanceManager for `getClient()` method**

The `manager.getClient(id)` method must exist to get the GatewayClient. Read `packages/server/src/instances/manager.ts` to verify. If it doesn't exist, add it — it should return the GatewayClient associated with an instance, or null if not connected.

**Step 3: Write tests**

Add to `packages/server/src/api/__tests__/lifecycle.test.ts`, in a new describe block after the existing agent tests. Mock `mergeChannelAccountConfig`:

```typescript
// At top — add to vi.mock for channel-config
vi.mock("../../lifecycle/channel-config.js", () => ({
  mergeChannelAccountConfig: vi.fn(),
}));

// Add import
import { mergeChannelAccountConfig } from "../../lifecycle/channel-config.js";

// In the test body:
describe("PUT /:id/channels/config", () => {
  it("merges channel config and writes back", async () => {
    const mockConfig = { channels: { telegram: { accounts: { default: { dmPolicy: "open" } } } } };
    const merged = { channels: { telegram: { accounts: { default: { dmPolicy: "allowlist" } } } } };
    vi.mocked(readRemoteConfig).mockResolvedValue(mockConfig);
    vi.mocked(mergeChannelAccountConfig).mockReturnValue(merged);
    vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

    const res = await app.request("/lifecycle/ssh-1-main/channels/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "telegram", accountId: "default", config: { dmPolicy: "allowlist" } }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(mergeChannelAccountConfig).toHaveBeenCalledWith(mockConfig, "telegram", "default", { dmPolicy: "allowlist" });
    expect(writeRemoteConfig).toHaveBeenCalledWith(mockExecutor, "$HOME/.openclaw-main", merged);
  });

  it("returns 404 for unknown instance", async () => {
    const res = await app.request("/lifecycle/nonexistent/channels/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "telegram", config: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when channel missing", async () => {
    const res = await app.request("/lifecycle/ssh-1-main/channels/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { dmPolicy: "open" } }),
    });
    expect(res.status).toBe(400);
  });

  it("creates snapshot after config update", async () => {
    vi.mocked(readRemoteConfig).mockResolvedValue({ channels: { tg: { accounts: { d: {} } } } });
    vi.mocked(mergeChannelAccountConfig).mockReturnValue({ channels: { tg: { accounts: { d: { dmPolicy: "open" } } } } });
    vi.mocked(writeRemoteConfig).mockResolvedValue(undefined);

    await app.request("/lifecycle/ssh-1-main/channels/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "tg", accountId: "d", config: { dmPolicy: "open" } }),
    });
    const snaps = db.prepare("SELECT * FROM config_snapshots WHERE instance_id = 'ssh-1-main'").all() as any[];
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe("channel config update");
  });
});
```

**Step 4: Run tests**

Run: `npx vitest run packages/server/src/api/__tests__/lifecycle.test.ts`
Expected: All tests PASS (existing + new)

Also: `npx vitest run packages/server/src/lifecycle/__tests__/channel-config.test.ts`

**Step 5: Commit**

```bash
git add packages/server/src/api/lifecycle.ts packages/server/src/api/__tests__/lifecycle.test.ts
git commit -m "feat(channels): add GET/POST/PUT channel management endpoints"
```

---

### Task 5: ChannelForm Component

**Files:**
- Create: `packages/web/src/components/ChannelForm.tsx`

**Context:** A form component for editing channel account configuration, following the same pattern as `AgentForm.tsx`. It edits the allowed fields: enabled, dmPolicy, groupPolicy, allowFrom, groupAllowFrom, historyLimit, dmHistoryLimit, textChunkLimit, chunkMode, blockStreaming.

**Step 1: Create the component**

Create `packages/web/src/components/ChannelForm.tsx`:

```typescript
import { useState } from "react";
import { X, Plus } from "lucide-react";

export interface ChannelFormValues {
  enabled: boolean;
  dmPolicy: string;
  groupPolicy: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  historyLimit: number | "";
  dmHistoryLimit: number | "";
  textChunkLimit: number | "";
  chunkMode: string;
  blockStreaming: boolean;
}

interface ChannelFormProps {
  values: ChannelFormValues;
  onChange: (values: ChannelFormValues) => void;
  channelType: string;
  accountId: string;
}

const DM_POLICY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "pairing", label: "Pairing" },
  { value: "allowlist", label: "Allowlist" },
  { value: "open", label: "Open" },
  { value: "disabled", label: "Disabled" },
];

const GROUP_POLICY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "open", label: "Open" },
  { value: "deny", label: "Deny" },
  { value: "allowlist", label: "Allowlist" },
];

const CHUNK_MODE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "length", label: "Length" },
  { value: "newline", label: "Newline" },
];

export function ChannelForm({ values, onChange, channelType, accountId }: ChannelFormProps) {
  const [allowInput, setAllowInput] = useState("");
  const [groupAllowInput, setGroupAllowInput] = useState("");

  const set = <K extends keyof ChannelFormValues>(key: K, val: ChannelFormValues[K]) =>
    onChange({ ...values, [key]: val });

  const addTag = (field: "allowFrom" | "groupAllowFrom", input: string, setInput: (v: string) => void) => {
    const tag = input.trim();
    if (tag && !values[field].includes(tag)) {
      set(field, [...values[field], tag]);
    }
    setInput("");
  };

  const removeTag = (field: "allowFrom" | "groupAllowFrom", tag: string) => {
    set(field, values[field].filter((t) => t !== tag));
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-3 mb-2">
        {channelType} / {accountId}
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="rounded border-edge"
        />
        <label className="text-sm text-ink">Enabled</label>
      </div>

      {/* DM Policy */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">DM Policy</label>
        <select
          value={values.dmPolicy}
          onChange={(e) => set("dmPolicy", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {DM_POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Group Policy */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Group Policy</label>
        <select
          value={values.groupPolicy}
          onChange={(e) => set("groupPolicy", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {GROUP_POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Allow From (tag input) */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">DM Allow From</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.allowFrom.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {tag}
              <button onClick={() => removeTag("allowFrom", tag)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={allowInput}
            onChange={(e) => setAllowInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("allowFrom", allowInput, setAllowInput); } }}
            placeholder="Add user ID..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={() => addTag("allowFrom", allowInput, setAllowInput)} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Group Allow From (tag input) */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Group Allow From</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.groupAllowFrom.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {tag}
              <button onClick={() => removeTag("groupAllowFrom", tag)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={groupAllowInput}
            onChange={(e) => setGroupAllowInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag("groupAllowFrom", groupAllowInput, setGroupAllowInput); } }}
            placeholder="Add group ID..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={() => addTag("groupAllowFrom", groupAllowInput, setGroupAllowInput)} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Messaging behavior */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-ink-3 mb-1">History Limit</label>
          <input
            type="number"
            value={values.historyLimit}
            onChange={(e) => set("historyLimit", e.target.value ? parseInt(e.target.value) : "")}
            placeholder="default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1">DM History Limit</label>
          <input
            type="number"
            value={values.dmHistoryLimit}
            onChange={(e) => set("dmHistoryLimit", e.target.value ? parseInt(e.target.value) : "")}
            placeholder="default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-ink-3 mb-1">Text Chunk Limit</label>
          <input
            type="number"
            value={values.textChunkLimit}
            onChange={(e) => set("textChunkLimit", e.target.value ? parseInt(e.target.value) : "")}
            placeholder="default"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-3 mb-1">Chunk Mode</label>
          <select
            value={values.chunkMode}
            onChange={(e) => set("chunkMode", e.target.value)}
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
          >
            {CHUNK_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Block Streaming */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={values.blockStreaming}
          onChange={(e) => set("blockStreaming", e.target.checked)}
          className="rounded border-edge"
        />
        <label className="text-sm text-ink">Block Streaming</label>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/components/ChannelForm.tsx
git commit -m "feat(channels): add ChannelForm component for editing channel account config"
```

---

### Task 6: Instance Channels Tab

**Files:**
- Modify: `packages/web/src/pages/Instance.tsx`

**Context:** Add a new "Channels" tab to the Instance detail page. This tab shows a list of channel account cards with status details, config info, and action buttons (Edit, Enable/Disable, Logout, Probe). The edit mode uses `ChannelForm`. Follow the pattern of `AgentsTab` for the data fetching and save logic.

**Step 1: Update Tab type**

Change line 26 from:
```typescript
type Tab = "overview" | "sessions" | "config" | "security" | "agents" | "llm" | "control";
```
to:
```typescript
type Tab = "overview" | "sessions" | "config" | "security" | "agents" | "channels" | "llm" | "control";
```

**Step 2: Add ChannelsTab component**

Add a new `ChannelsTab` component in Instance.tsx (before the main Instance component). It should:

1. Fetch channel details from `GET /lifecycle/{id}/channels` on mount
2. Render each channel's accounts as cards showing:
   - Header: channel type + label + account ID + status dot (connected/stopped/error/disabled)
   - Status line: lastConnectedAt, lastInboundAt, lastOutboundAt (using `timeAgo()`)
   - Reconnects + lastError
   - Policy display: dmPolicy, groupPolicy, allowFrom tags, groupAllowFrom tags
   - Config display: historyLimit, dmHistoryLimit, textChunkLimit, chunkMode, blockStreaming
3. Action buttons per account:
   - **Edit** — opens inline ChannelForm
   - **Enable/Disable** — quick toggle via PUT `/lifecycle/{id}/channels/config`
   - **Logout** — POST `/lifecycle/{id}/channels/logout`
   - **Probe** — POST `/lifecycle/{id}/channels/probe` (refreshes all)
4. Save from edit form calls PUT `/lifecycle/{id}/channels/config`, then shows RestartDialog
5. Probe button at the top refreshes all channels with live status

Import `ChannelForm` and `ChannelFormValues` from `../components/ChannelForm`.

The account status dot logic:
- `connected` → green (bg-ok)
- `running && !connected` → yellow (bg-warn)
- `!enabled` → gray with "disabled" label
- `lastError` → red (bg-danger)
- else → gray (bg-ink-3)

**Step 3: Add tab to tab switcher**

In the tabs array (around line 1699-1707), add:
```typescript
{ key: "channels", label: "Channels" },
```

In the conditional render section (around line 1737-1743), add:
```typescript
{activeTab === "channels" && <ChannelsTab inst={inst} />}
```

**Step 4: Verify manually**

Run: `npm run dev`
Navigate to an instance detail page, click the "Channels" tab.
Expected: Channel account cards with status + config details + action buttons.

**Step 5: Commit**

```bash
git add packages/web/src/pages/Instance.tsx
git commit -m "feat(channels): add Channels tab to Instance detail with account cards and actions"
```

---

### Task 7: OverviewTab Summary Card

**Files:**
- Modify: `packages/web/src/pages/Instance.tsx`

**Context:** Replace the current channel badges list in OverviewTab (lines 73-86) with a clickable summary card that shows channel count and running count, and switches to the Channels tab on click.

**Step 1: Update OverviewTab**

The OverviewTab currently receives `inst` as a prop. It also needs a way to switch tabs. Modify OverviewTab props to accept an `onSwitchTab` callback:

```typescript
function OverviewTab({ inst, onSwitchTab }: { inst: InstanceInfo; onSwitchTab: (tab: Tab) => void }) {
```

Replace the channels section (lines 73-86 approximately) with:

```typescript
{/* Channels summary card */}
<div>
  <h3 className="text-xs uppercase tracking-wider text-ink-3 mb-2">Channels</h3>
  <button
    onClick={() => onSwitchTab("channels")}
    className="w-full text-left p-3 rounded border border-edge bg-s2/50 hover:bg-s2 transition-colors"
  >
    <div className="text-sm text-ink">
      {inst.channels.length} channel{inst.channels.length !== 1 ? "s" : ""},{" "}
      <span className="text-ok">{inst.channels.filter((c) => c.running).length} running</span>
    </div>
    <div className="text-xs text-ink-3 mt-1">Click to manage channels</div>
  </button>
</div>
```

Update the OverviewTab call site to pass the `onSwitchTab` prop:

```typescript
{activeTab === "overview" && <OverviewTab inst={inst} onSwitchTab={setActiveTab} />}
```

**Step 2: Commit**

```bash
git add packages/web/src/pages/Instance.tsx
git commit -m "feat(channels): replace OverviewTab channel badges with summary card linking to Channels tab"
```

---

### Task 8: Top-Level Channels Page

**Files:**
- Create: `packages/web/src/pages/Channels.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/App.tsx` (or wherever routes are defined)

**Context:** A cross-instance channel summary page, following the Sessions page pattern. Shows all channels across all connected instances with instance filter bar. Click a row to navigate to that instance's Channels tab.

**Step 1: Create Channels page**

Create `packages/web/src/pages/Channels.tsx`:

```typescript
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, RefreshCw } from "lucide-react";
import { useInstances } from "../hooks/useInstances";
import { get } from "../lib/api";

interface ChannelRow {
  instanceId: string;
  instanceLabel: string;
  channelType: string;
  channelLabel: string;
  accountCount: number;
  runningCount: number;
  connectedCount: number;
  lastActivity: number | null;
}

export default function Channels() {
  const { instances } = useInstances();
  const navigate = useNavigate();
  const [selectedHost, setSelectedHost] = useState("all");
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(false);

  const connectedInstances = instances.filter((i) => i.connection.status === "connected");

  // Group instances by host
  const hostGroups = (() => {
    const groups = new Map<string, { hostKey: string; hostLabel: string; instances: typeof connectedInstances }>();
    for (const inst of connectedInstances) {
      const parts = inst.id.split("-");
      const hostKey = parts.length >= 2 ? parts.slice(0, -1).join("-") : inst.id;
      const hostLabel = inst.connection.label?.split("/")[0] || hostKey;
      if (!groups.has(hostKey)) groups.set(hostKey, { hostKey, hostLabel, instances: [] });
      groups.get(hostKey)!.instances.push(inst);
    }
    return [...groups.values()];
  })();

  const visibleInstances = selectedHost === "all"
    ? connectedInstances
    : hostGroups.find((g) => g.hostKey === selectedHost)?.instances || [];

  useEffect(() => {
    loadChannels();
  }, [visibleInstances.map((i) => i.id).join(",")]);

  async function loadChannels() {
    setLoading(true);
    const allRows: ChannelRow[] = [];
    await Promise.all(
      visibleInstances.map(async (inst) => {
        try {
          const data = await get(`/lifecycle/${inst.id}/channels`);
          for (const ch of data.channels || []) {
            const running = ch.accounts.filter((a: any) => a.running).length;
            const connected = ch.accounts.filter((a: any) => a.connected).length;
            const lastActivity = Math.max(
              ...ch.accounts.map((a: any) => Math.max(a.lastInboundAt || 0, a.lastOutboundAt || 0)),
              0,
            ) || null;
            allRows.push({
              instanceId: inst.id,
              instanceLabel: inst.connection.label || inst.id,
              channelType: ch.type,
              channelLabel: ch.label,
              accountCount: ch.accounts.length,
              runningCount: running,
              connectedCount: connected,
              lastActivity,
            });
          }
        } catch { /* skip failed instances */ }
      }),
    );
    setRows(allRows);
    setLoading(false);
  }

  function timeAgo(ts: number | null): string {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Channels</h1>
        <button onClick={loadChannels} disabled={loading} className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Host filter */}
      {hostGroups.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedHost("all")}
            className={`px-3 py-1 text-sm rounded ${selectedHost === "all" ? "bg-brand text-white" : "bg-s2 text-ink-2 hover:bg-s3"}`}
          >
            All
          </button>
          {hostGroups.map((g) => (
            <button
              key={g.hostKey}
              onClick={() => setSelectedHost(g.hostKey)}
              className={`px-3 py-1 text-sm rounded ${selectedHost === g.hostKey ? "bg-brand text-white" : "bg-s2 text-ink-2 hover:bg-s3"}`}
            >
              {g.hostLabel}
            </button>
          ))}
        </div>
      )}

      {/* Channel table */}
      {loading && rows.length === 0 ? (
        <div className="text-ink-3 text-sm">Loading channels...</div>
      ) : rows.length === 0 ? (
        <div className="text-ink-3 text-sm">No channels found on connected instances.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3 uppercase tracking-wider border-b border-edge">
                <th className="pb-2 pr-4">Instance</th>
                <th className="pb-2 pr-4">Channel</th>
                <th className="pb-2 pr-4">Accounts</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.instanceId}-${row.channelType}`}
                  onClick={() => navigate(`/instance/${row.instanceId}?tab=channels`)}
                  className="border-b border-edge/50 hover:bg-s2/50 cursor-pointer"
                >
                  <td className="py-2 pr-4 text-ink-2">{row.instanceLabel}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <Radio size={14} className="text-ink-3" />
                      <span className="text-ink">{row.channelLabel}</span>
                      <span className="text-ink-3 text-xs">{row.channelType}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-ink-2">{row.accountCount}</td>
                  <td className="py-2 pr-4">
                    <span className="text-ok">{row.connectedCount} connected</span>
                    {row.runningCount > row.connectedCount && (
                      <span className="text-warn ml-2">{row.runningCount - row.connectedCount} starting</span>
                    )}
                    {row.accountCount > row.runningCount && (
                      <span className="text-ink-3 ml-2">{row.accountCount - row.runningCount} stopped</span>
                    )}
                  </td>
                  <td className="py-2 text-ink-3">{timeAgo(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add to Sidebar**

In `packages/web/src/components/Sidebar.tsx`, add to the nav array (import `Radio` from lucide-react):

```typescript
{ to: "/channels", label: "Channels", icon: Radio },
```

Place it after the Sessions entry (logical grouping: Dashboard → Sessions → Channels → Usage → ...).

**Step 3: Add route**

In the router config file (likely `packages/web/src/App.tsx` or similar), add:

```typescript
import Channels from "./pages/Channels";
// In routes:
<Route path="/channels" element={<Channels />} />
```

**Step 4: Handle `?tab=channels` query param in Instance.tsx**

In Instance.tsx, the `activeTab` state initialization should check for `?tab=` query param:

```typescript
const [searchParams] = useSearchParams();
const [activeTab, setActiveTab] = useState<Tab>(() => {
  const t = searchParams.get("tab");
  return (t && ["overview", "sessions", "config", "security", "agents", "channels", "llm", "control"].includes(t))
    ? t as Tab
    : "overview";
});
```

(Check if this already exists — the `useSearchParams` is already imported at line 2.)

**Step 5: Commit**

```bash
git add packages/web/src/pages/Channels.tsx packages/web/src/components/Sidebar.tsx packages/web/src/App.tsx packages/web/src/pages/Instance.tsx
git commit -m "feat(channels): add top-level Channels page with cross-instance summary"
```

---

### Task 9: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`

**Step 1: Update README**

Add Channel Management section to Features (after Agent Configuration):

```markdown
### Channel Management
Full channel lifecycle management — view all connected channels across instances with detailed account-level status (connection state, last activity, reconnect attempts, errors). Edit channel policies (DM/group policy, allowlists) and messaging behavior (history limits, chunk settings) through a structured form. Operational controls: live connectivity probe, account logout, and enable/disable with restart confirmation. Top-level cross-instance channel overview for fleet-wide visibility.
```

Add new API endpoints to the API table:

```markdown
| `/api/lifecycle/:id/channels` | GET | Channel status with account details |
| `/api/lifecycle/:id/channels/probe` | POST | Probe channel connectivity |
| `/api/lifecycle/:id/channels/logout` | POST | Logout channel account |
| `/api/lifecycle/:id/channels/config` | PUT | Update channel account config |
```

**Step 2: Update CHANGELOG**

Add Session 6 entry with features, and any lessons learned during implementation.

**Step 3: Commit**

```bash
git add README.md docs/CHANGELOG.md
git commit -m "docs: add channel management to README and CHANGELOG"
```

---

## Task Dependency Graph

```
Task 1 (types) ──► Task 2 (GatewayClient) ──► Task 4 (backend endpoints)
                                                      │
Task 3 (merge logic + tests) ────────────────────────►│
                                                      │
Task 5 (ChannelForm component) ──► Task 6 (Instance Channels Tab) ──► Task 7 (OverviewTab)
                                                                            │
                                                      Task 8 (Top-level page) ──► Task 9 (docs)
```

Tasks 1-3 can be done first (backend). Tasks 5-6 can start after Task 4. Task 7 depends on Task 6. Task 8 depends on Task 4. Task 9 is last.
