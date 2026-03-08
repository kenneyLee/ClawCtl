# Agent Config Management Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete agent configuration management — CRUD agents, edit global defaults, apply permission templates, with structured form UI replacing raw JSON editing.

**Architecture:** New `AgentsTab` in Instance detail page. All config changes go through existing `readRemoteConfig` / `writeRemoteConfig` pipeline. Template apply is pure frontend logic (read config → merge template fields → fill form → user saves). After every config write, prompt user "restart now?".

**Tech Stack:** React + Tailwind (frontend), Hono API (backend), existing lifecycle config read/write endpoints.

---

## Data Model

### openclaw.json agent config structure

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "gpt-4o" },
      "thinkingDefault": "full"
    },
    "list": [
      {
        "id": "main",
        "model": { "primary": "claude-sonnet-4-5-20250514" },
        "thinkingDefault": "brief",
        "tools": {
          "allow": ["read", "search", "exec"],
          "exec": {
            "security": "allowlist",
            "host": "localhost",
            "ask": true,
            "applyPatch": { "workspaceOnly": true }
          }
        }
      }
    ]
  }
}
```

### Agent form fields

| Field | Type | Source in config | Notes |
|-------|------|-----------------|-------|
| id | string (readonly on edit) | `list[].id` | Required, unique, used as key |
| model | combobox | `list[].model.primary` | Falls back to `defaults.model.primary` |
| thinkingDefault | select | `list[].thinkingDefault` | "full" / "brief" / "disabled" / inherit |
| toolsAllow | tag input | `list[].tools.allow` | Array of strings, `*` = all |
| execSecurity | select | `list[].tools.exec.security` | "allowlist" / "full" / "disabled" |
| workspaceOnly | toggle | `list[].tools.exec.applyPatch.workspaceOnly` | boolean |

### Global defaults form fields

| Field | Type | Source |
|-------|------|--------|
| defaultModel | combobox | `agents.defaults.model.primary` |
| defaultThinking | select | `agents.defaults.thinkingDefault` |

---

## Backend Changes

### 1. New endpoint: GET /lifecycle/:id/models

Extract available models from instance config + running agents. No new RPC needed.

```
GET /lifecycle/:id/models
Response: { models: string[], defaultModel: string }
```

Implementation:
- Read openclaw.json via `readRemoteConfig`
- Collect unique models from `agents.defaults.model.primary` + all `agents.list[].model.primary`
- Merge with a hardcoded COMMON_MODELS list (gpt-4o, gpt-4o-mini, claude-sonnet-4-5-20250514, claude-haiku-4-5-20251001, etc.)
- Deduplicate and return

### 2. New endpoint: PUT /lifecycle/:id/agents

Structured agent config write (safer than raw JSON PUT).

```
PUT /lifecycle/:id/agents
Body: {
  defaults: { model: string, thinkingDefault: string },
  agents: [{ id, model, thinkingDefault, toolsAllow, execSecurity, workspaceOnly }]
}
Response: { ok: true }
```

Implementation:
1. Read current openclaw.json
2. Update `agents.defaults.model.primary` and `agents.defaults.thinkingDefault`
3. Rebuild `agents.list` from the provided agents array, preserving any unknown fields in existing agent entries
4. Write back via `writeRemoteConfig`
5. Auto-create snapshot with reason "agent config update"
6. Audit log: `lifecycle.agent-config`

### 3. New endpoint: DELETE /lifecycle/:id/agents/:agentId

```
DELETE /lifecycle/:id/agents/:agentId
Response: { ok: true }
```

Implementation:
1. Read openclaw.json
2. Remove agent from `agents.list` by id
3. Also remove any `bindings[]` entries referencing this agentId
4. Write back + snapshot + audit log

### 4. No changes to security.ts

Template preview endpoint already exists. Template apply is handled on frontend by:
1. GET `/instances/templates/:id` to get template config
2. Fill form fields with template values
3. User adjusts and saves via PUT `/lifecycle/:id/agents`

---

## Frontend Changes

### 1. AgentsTab component (Instance.tsx)

New tab alongside existing ControlTab.

```
+--------------------------------------------------+
| [Overview] [Sessions] [Tools] [Agents] [Control]  |
+--------------------------------------------------+

AgentsTab layout:
+--------------------------------------------------+
| Global Defaults                                    |
| Model: [gpt-4o     v]  Thinking: [full    v]     |
+--------------------------------------------------+
| Agents                              [+ New Agent] |
| +------+---------------------------------------+  |
| | main | Model:    [claude-sonnet v] (custom)   |  |
| |      | Thinking: [brief         v]            |  |
| | dev  | Tools:    [read] [search] [exec] [+]   |  |
| |      | Exec:     [allowlist v] workspace-only  |  |
| |      |                                         |  |
| |      | [Apply Template]  [Delete]  [Save]      |  |
| +------+---------------------------------------+  |
+--------------------------------------------------+
```

**Left sidebar:** Agent list with active selection
**Right panel:** Selected agent's config form
**Top section:** Global defaults (always visible)

### 2. Agent form behavior

- **Create:** Click "+ New Agent" → empty form, must enter ID → Save adds to `agents.list`
- **Edit:** Select agent → form populated with current values. Inherited values shown as placeholder with "(default: gpt-4o)" hint
- **Delete:** Confirm dialog → removes from list + cleans up bindings
- **Save:** Validates form → PUT `/lifecycle/:id/agents` with full agents array → on success, show restart dialog

### 3. Template apply flow

1. Click "Apply Template" on agent form
2. Modal: list all templates (presets + custom)
3. Select template → show diff preview (current values vs template values)
4. Confirm → template values fill the form fields (does NOT save yet)
5. User can tweak values, then clicks Save

### 4. Restart confirmation dialog

After successful config save:
```
+----------------------------------+
|  Config saved successfully.       |
|                                   |
|  Restart instance to apply?       |
|                                   |
|  [Restart Now]    [Later]         |
+----------------------------------+
```

"Restart Now" → POST `/lifecycle/:id/restart`
"Later" → close dialog

### 5. Model combobox

- Dropdown with models from GET `/lifecycle/:id/models`
- Allows free-text input for custom model names
- Shows which models are currently in use (tag)

### 6. Security.tsx changes

TemplateManager: add "Apply" button per template row → navigates to Instance page AgentsTab with `?applyTemplate=<templateId>` query param. AgentsTab detects this and opens the template apply modal.

---

## File inventory

### Backend (packages/server/src/)

| Action | File | What |
|--------|------|------|
| Modify | `api/lifecycle.ts` | Add GET `/:id/models`, PUT `/:id/agents`, DELETE `/:id/agents/:agentId` |
| Create | `lifecycle/agent-config.ts` | Helper: `mergeAgentConfig()`, `removeAgent()`, `extractModels()` |

### Frontend (packages/web/src/)

| Action | File | What |
|--------|------|------|
| Modify | `pages/Instance.tsx` | Add AgentsTab, tab routing |
| Create | `components/AgentForm.tsx` | Agent edit form (model combobox, tools tagger, exec select, etc.) |
| Create | `components/TemplateApplyModal.tsx` | Template selection + diff preview modal |
| Create | `components/RestartDialog.tsx` | Post-save restart confirmation |
| Modify | `pages/Security.tsx` | Add "Apply" button to TemplateManager rows |

### Tests (packages/server/src/)

| Action | File | What |
|--------|------|------|
| Create | `lifecycle/__tests__/agent-config.test.ts` | Unit tests for mergeAgentConfig, removeAgent, extractModels |
| Create | `api/__tests__/agent-config-api.test.ts` | Integration tests for new endpoints |

---

## Edge cases

1. **Agent ID conflict:** Creating agent with existing ID → return 409
2. **Delete default agent:** If agent is referenced as `defaultId` in runtime, warn but allow (config is declarative)
3. **Empty agents.list:** Valid state — openclaw falls back to built-in defaults
4. **Template with tools not available:** Apply anyway — openclaw ignores unknown tool names gracefully
5. **Config write failure (SSH error):** Show error, don't show restart dialog
6. **Concurrent edits:** Last-write-wins (same as raw JSON editor), snapshot provides rollback

---

## Out of scope

- Bindings management (agent-to-channel mapping) — separate feature
- API key / token management — openclaw service-level, not agent config
- Model pricing / token limit configuration — provider-level, not in openclaw.json
