# Channel Management Enhancement — Design Document

## Goal

Upgrade channel (渠道) functionality from basic status badges to a full management experience: detailed account listing, configuration editing, and operational controls.

## Architecture

Two-level view (top-level overview + instance-level deep management) with config editing and operational actions. Data comes from Gateway's `channels.status` RPC (full response including `channelAccounts`) and config from `config.get` RPC's `parsed.channels`.

## Decisions

- **Scope**: Read + write config + operational controls (probe, logout, enable/disable)
- **Placement**: Top-level Channels page (cross-instance summary) + Instance detail Channels Tab (per-instance management)
- **OverviewTab**: Replace channel badges with summary card linking to Channels Tab
- **Config editing scope**: Common policies (dmPolicy, groupPolicy, enabled, allowFrom, groupAllowFrom) + messaging behavior (historyLimit, dmHistoryLimit, textChunkLimit, chunkMode, blockStreaming). No channel-specific credential fields.
- **Enable/disable**: Config-level toggle (modify `enabled` field, write config, prompt restart via RestartDialog)
- **Not doing**: Channel-specific credential editing (use raw config editor), channel creation/deletion, cross-instance batch operations

---

## 1. Data Layer

### Upgrade `channels.status` RPC Usage

Current ClawCtl only uses the `channels` summary field. The RPC actually returns much more:

```typescript
{
  ts: number;
  channelOrder: string[];                          // display order
  channelLabels: Record<string, string>;           // display names
  channels: Record<string, unknown>;               // summary per channel
  channelAccounts: Record<string, AccountSnapshot[]>; // full account snapshots
  channelDefaultAccountId: Record<string, string>;  // default account per channel
}
```

### AccountSnapshot Fields (from OpenClaw source)

```typescript
{
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
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
  allowFrom?: string[];
  mode?: string;
}
```

### Updated ChannelInfo Type

Replace current minimal `ChannelInfo` with a richer structure:

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
  allowFrom?: string[];
  groupAllowFrom?: string[];
}

export interface ChannelDetail {
  type: string;
  label: string;
  defaultAccountId?: string;
  accounts: ChannelAccountInfo[];
}
```

## 2. Top-Level Channels Page

Cross-instance summary view, following the Sessions page pattern:

- **Instance filter bar** (consistent with Sessions page)
- **Channel summary table**: one row per channel-type per instance
  - Instance name | Channel type + label | Account count | Running/Stopped count | Last activity
- **Click**: Navigate to instance's Channels Tab

## 3. Instance Channels Tab

Per-instance deep management. Main area is a list of channel account cards.

### Account Card Layout

```
┌─────────────────────────────────────────────────┐
│ [icon] telegram / account-id-1    ● connected   │
│                                                  │
│ Connected: 2h ago  Last msg in: 5m  Out: 3m     │
│ Reconnects: 0    Error: (none)                   │
│                                                  │
│ DM Policy: allowlist    Group Policy: open       │
│ Allow: [user1] [user2]  Group Allow: [grp1]     │
│                                                  │
│ History: 50  DM History: 20  Chunk: 4000 chars   │
│ Chunk Mode: length   Block Streaming: off        │
│                                                  │
│ [Edit]  [Enable/Disable]  [Logout]  [Probe]     │
└─────────────────────────────────────────────────┘
```

### Edit Form (Modal/Inline)

Similar to AgentForm pattern:
- `enabled` — toggle switch
- `dmPolicy` — select: pairing / allowlist / open / disabled
- `groupPolicy` — select: open / deny / allowlist
- `allowFrom` — tag input (like toolsAllow in AgentForm)
- `groupAllowFrom` — tag input
- `historyLimit` — number input
- `dmHistoryLimit` — number input
- `textChunkLimit` — number input
- `chunkMode` — select: length / newline
- `blockStreaming` — toggle switch

Save writes back to `openclaw.json` via config endpoint, creates snapshot, triggers RestartDialog.

## 4. OverviewTab Modification

Replace current channel badge list with a summary card:
- Display: "N channels, M running"
- Clickable: switches to Channels Tab

## 5. Operational Controls

### Probe
- Call `channels.status` with `probe: true` parameter
- Refreshes account status with live connectivity check
- Timeout configurable (default 10s)

### Logout
- Call `channels.logout` RPC with channel + accountId
- Clears stored credentials for the account
- Useful for re-authentication flows

### Enable/Disable
- Modify account's `enabled` field in `parsed.channels.<type>.accounts.<id>`
- Write config back via existing `writeRemoteConfig`
- Create config snapshot
- Show RestartDialog for changes to take effect

## 6. Backend API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/lifecycle/:id/channels` | GET | Full channel status with account snapshots |
| `/lifecycle/:id/channels/probe` | POST | Probe channel status (live connectivity) |
| `/lifecycle/:id/channels/logout` | POST | Logout channel account `{ channel, accountId }` |
| `/lifecycle/:id/channels/config` | PUT | Update channel config (policies + behavior) |

### GET /lifecycle/:id/channels

Calls `channels.status` RPC (without probe), returns:
```json
{
  "channelOrder": ["telegram", "feishu"],
  "channelLabels": { "telegram": "Telegram", "feishu": "Feishu" },
  "channels": [ ... ],
  "defaultAccountIds": { "telegram": "default", "feishu": "abc" }
}
```

### POST /lifecycle/:id/channels/probe

Calls `channels.status` with `{ probe: true }`, returns same structure but with live status.

### POST /lifecycle/:id/channels/logout

Body: `{ channel: string, accountId?: string }`
Forwards to `channels.logout` RPC.

### PUT /lifecycle/:id/channels/config

Body:
```json
{
  "channel": "telegram",
  "accountId": "default",
  "config": {
    "enabled": true,
    "dmPolicy": "allowlist",
    "groupPolicy": "open",
    "allowFrom": ["user1", "user2"],
    "groupAllowFrom": [],
    "historyLimit": 50,
    "dmHistoryLimit": 20,
    "textChunkLimit": 4000,
    "chunkMode": "length",
    "blockStreaming": false
  }
}
```

Reads current config, merges channel account fields, writes back, creates snapshot, logs operation.

## 7. Out of Scope

- Channel-specific credential fields (botToken, appSecret, etc.) — use raw config editor
- Channel type creation/deletion — determined by OpenClaw installation
- Cross-instance batch operations — top-level page is summary + navigation only
- Channel-specific sub-features (Telegram groups, Discord guilds, etc.) — too granular for v1
