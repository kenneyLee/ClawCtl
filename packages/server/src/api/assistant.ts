import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { HostStore } from "../hosts/store.js";
import type { InstanceManager } from "../instances/manager.js";
import type { LlmClient } from "../llm/client.js";
import type { ChatMessage, ToolDef, ToolCall } from "../llm/types.js";
import { requireWrite } from "../auth/middleware.js";
import { auditLog } from "../audit.js";
import { getExecutor } from "../executor/factory.js";
import { readRemoteConfig, writeRemoteConfig, getConfigDir, profileFromInstanceId } from "../lifecycle/config.js";
import { getProcessStatus } from "../lifecycle/service.js";
import { SnapshotStore } from "../lifecycle/snapshot.js";

const SYSTEM_PROMPT = `You are ClawCtl AI Assistant, an expert on OpenClaw Gateway configuration and operations.

## Your Role
Help users understand, diagnose, and modify their OpenClaw Gateway instances.

## Documentation Topics (use get_docs to retrieve)
- config_overview: Config file structure and key sections
- agents: Agent configuration (defaults, models, tools, security)
- channels: Channel config (lark, feishu, telegram, policies)
- bindings: Agent-to-channel binding rules
- security: Tool permissions, exec security, workspace restrictions
- clawctl_api: ClawCtl management API endpoints

## Guidelines
- Use get_docs before answering questions about OpenClaw configuration — don't guess
- Always read the config (get_config) before suggesting changes
- For config updates, use update_config with a JSON merge patch
- After config changes, suggest restarting if needed
- Use Chinese when the user writes in Chinese, English otherwise
- Be concise and practical
`;

/** Documentation topics — loaded on-demand via get_docs tool */
const DOCS: Record<string, string> = {
  config_overview: `# OpenClaw Config Structure
Config file: \`openclaw.json\` at \`~/.openclaw/\` (default) or \`~/.openclaw-{profile}/\`.
Top-level sections: gateway, agents, channels, bindings.
Use get_docs with specific topic (agents, channels, bindings, security) for details.`,

  agents: `# Agent Configuration
- \`agents.defaults\`: global defaults applied to all agents
  - \`model.primary\`: default LLM model (e.g. "gpt-4o", "claude-sonnet-4-20250514")
  - \`thinkingDefault\`: thinking depth ("low" | "high")
  - \`models\`: per-model parameter overrides (temperature, maxTokens, etc.)
- \`agents.list[]\`: array of agent definitions, each with:
  - \`id\`: unique identifier
  - \`name\`: display name
  - \`workspace\`: working directory path
  - \`agentDir\`: agent-specific config directory
  - \`model.primary\`: per-agent model override
  - \`thinkingDefault\`: per-agent thinking depth override
  - \`tools.allow[]\`: whitelisted tool names (e.g. ["read","write","exec"])
  - \`tools.exec.security\`: exec tool security level
  - \`tools.exec.applyPatch.workspaceOnly\`: restrict patches to workspace (boolean)
  - \`tools.fs.workspaceOnly\`: restrict file access to workspace (boolean)`,

  channels: `# Channel Configuration
- \`channels.{type}\` where type is: lark, feishu, telegram, slack, etc.
  - \`dmPolicy\`: direct message policy ("allow" | "deny" | "allowlist")
  - \`groupPolicy\`: group message policy ("allow" | "deny" | "allowlist")
  - \`accounts\`: map of account configs keyed by account ID
    - Each account: app credentials, tokens, webhook settings specific to channel type
    - Lark/Feishu: appId, appSecret, verificationToken, encryptKey
    - Telegram: botToken
    - Slack: botToken, signingSecret, appToken`,

  bindings: `# Bindings Configuration
- \`bindings[]\`: array mapping agents to channels
  - \`agentId\`: which agent handles messages
  - \`match\`: conditions for routing
    - \`channel\`: channel type (e.g. "lark", "telegram")
    - \`accountId\`: specific account ID (optional)
    - \`peer\`: specific user/group ID (optional)
  - First matching binding wins; unmatched messages use default agent`,

  security: `# Security Configuration
- Agent-level tool restrictions:
  - \`tools.allow[]\`: whitelist of permitted tools
  - \`tools.exec.security\`: "strict" (require approval) | "permissive" (auto-execute)
  - \`tools.exec.applyPatch.workspaceOnly\`: true = patches only in workspace dir
  - \`tools.fs.workspaceOnly\`: true = file operations only in workspace dir
- Gateway-level:
  - \`gateway.auth.token\`: authentication token for WebSocket connections
  - \`gateway.auth.method\`: "token" | "none"`,

  clawctl_api: `# ClawCtl Management API
Instance management:
- GET /api/instances — list all instances
- POST /api/instances — add instance {url, label}
- GET /api/instances/:id/config — read raw config
- POST /api/instances/:id/refresh — refresh instance data

Lifecycle (requires SSH host):
- POST /api/lifecycle/:id/start — start instance
- POST /api/lifecycle/:id/stop — stop instance
- POST /api/lifecycle/:id/restart — restart instance
- GET /api/lifecycle/:id/logs — tail logs
- GET /api/lifecycle/:id/snapshots — list config snapshots
- POST /api/lifecycle/:id/snapshots/:snapId/restore — restore snapshot

Settings:
- GET /api/settings — read all settings
- PUT /api/settings — update settings (admin only)

Monitoring:
- GET /api/monitoring/:id/metrics — host CPU/memory/disk metrics`,
};

const TOOLS: ToolDef[] = [
  {
    name: "get_docs",
    description: "Look up OpenClaw documentation by topic. Available topics: config_overview, agents, channels, bindings, security, clawctl_api. Call this before answering questions about OpenClaw config structure or best practices.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Documentation topic to retrieve",
          enum: Object.keys(DOCS),
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_config",
    description: "Read the current OpenClaw config for this instance. Call this first to understand the current state before making changes.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_config",
    description: "Update the OpenClaw config by merging a partial config object into the existing config. A snapshot is created before writing. The partial config is deep-merged — only specified fields are changed, everything else is preserved.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "object",
          description: "Partial config object to deep-merge into the existing config. Only include fields you want to change.",
        },
        reason: {
          type: "string",
          description: "Brief description of what this change does (for the snapshot log)",
        },
      },
      required: ["patch", "reason"],
    },
  },
  {
    name: "get_status",
    description: "Check whether the instance process is currently running",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "restart_instance",
    description: "Restart the OpenClaw Gateway instance. Use after config changes that require a restart to take effect.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function assistantRoutes(
  hostStore: HostStore,
  manager: InstanceManager,
  llm: LlmClient,
  db: Database.Database,
) {
  const app = new Hono();
  const snapshots = new SnapshotStore(db);
  snapshots.init();

  app.use("*", requireWrite("lifecycle"));

  app.post("/chat", async (c) => {
    if (!llm.isConfigured()) return c.json({ error: "LLM not configured. Go to Settings to set API key." }, 400);

    const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; instanceId?: string; pageContext?: string }>();
    if (!body.messages?.length) return c.json({ error: "messages required" }, 400);

    const id = body.instanceId;
    const inst = id ? manager.get(id) : null;

    const profile = id ? profileFromInstanceId(id) : null;
    const configDir = profile ? getConfigDir(profile) : null;
    const exec = id ? getExecutor(id, hostStore) : null;

    // Build context
    let systemMessage = SYSTEM_PROMPT;

    // Add all hosts and instances overview
    const allHosts = hostStore.list();
    const allInstances = manager.getAll();
    if (allHosts.length || allInstances.length) {
      let envSection = "## Environment Overview\n";
      if (allHosts.length) {
        envSection += "### Hosts\n";
        for (const h of allHosts) {
          const hostInstances = allInstances.filter((i) => i.id.startsWith(`ssh-${h.id}-`));
          envSection += `- ${h.label}: ssh ${h.username}@${h.host} -p ${h.port}\n`;
          for (const hi of hostInstances) {
            envSection += `  - Instance "${hi.connection.label || hi.id}" [${hi.connection.status}]${hi.version ? ` v${hi.version}` : ""}\n`;
          }
        }
      }
      const localInstances = allInstances.filter((i) => i.id.startsWith("local-"));
      if (localInstances.length) {
        envSection += "### Local\n";
        for (const li of localInstances) {
          envSection += `- Instance "${li.connection.label || li.id}" [${li.connection.status}]${li.version ? ` v${li.version}` : ""}\n`;
        }
      }
      systemMessage += `\n\n${envSection}`;
    }

    if (inst && id) {
      const hostMatch = id.match(/^ssh-(\d+)-/);
      const hostId = hostMatch ? parseInt(hostMatch[1]) : null;
      const host = hostId ? allHosts.find((h) => h.id === hostId) : null;

      const instanceContext = [
        `Instance ID: ${id}`,
        `Label: ${inst.connection.label || id}`,
        `Profile: ${profile}`,
        `Config dir: ${configDir}`,
        `Connection status: ${inst.connection.status}`,
        `Sessions: ${inst.sessions.length}`,
        inst.version ? `Version: ${inst.version}` : "",
        host ? `Host: ssh ${host.username}@${host.host} -p ${host.port}` : id.startsWith("local-") ? "Host: localhost" : "",
      ].filter(Boolean).join("\n");
      systemMessage += `\n\n## Current Instance Context\n${instanceContext}`;
    } else {
      systemMessage += `\n\n## Context\nNo specific instance selected. You can answer general questions about OpenClaw configuration and best practices. Tool calls requiring an instance will not be available.`;
    }
    if (body.pageContext) {
      systemMessage += `\n\nUser is currently on: ${body.pageContext}`;
    }

    // Build messages array with system prompt
    const messages: ChatMessage[] = [
      { role: "system", content: systemMessage },
      ...body.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    // Tool execution loop — LLM may call tools, we execute and feed results back
    const MAX_TOOL_ROUNDS = 5;
    let round = 0;
    const actions: Array<{ tool: string; args: any; result: string }> = [];

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      // get_docs is always available; instance tools need an active instance
      const availableTools = inst && exec ? TOOLS : TOOLS.filter((t) => t.name === "get_docs");
      let response;
      try {
        response = await llm.chat({ messages, tools: availableTools.length ? availableTools : undefined, maxTokens: 2000 });
      } catch (err: any) {
        console.error(`[assistant] LLM chat error (round ${round}):`, err.message);
        return c.json({ error: err.message }, 500);
      }
      messages.push(response.message);

      if (!response.message.tool_calls?.length) {
        // No tool calls — return the final text response
        return c.json({
          reply: response.message.content,
          actions,
          tokensUsed: response.tokensUsed,
        });
      }

      // Execute each tool call
      for (const tc of response.message.tool_calls) {
        const args = JSON.parse(tc.function.arguments || "{}");
        let result: string;

        try {
          if (tc.function.name === "get_docs") {
            const topic = args.topic as string;
            result = DOCS[topic] || `Unknown topic "${topic}". Available: ${Object.keys(DOCS).join(", ")}`;
          } else if (!exec || !configDir || !id || !inst) {
            result = "No instance selected. Please navigate to an instance page to use this tool.";
          } else {
          switch (tc.function.name) {
            case "get_config": {
              const config = await readRemoteConfig(exec, configDir);
              result = JSON.stringify(config, null, 2);
              break;
            }
            case "update_config": {
              const current = await readRemoteConfig(exec, configDir);
              // Create snapshot before change
              snapshots.create(id, JSON.stringify(current), `before: ${args.reason || "AI assistant change"}`);
              const merged = deepMerge(current, args.patch);
              await writeRemoteConfig(exec, configDir, merged);
              snapshots.create(id, JSON.stringify(merged), `AI assistant: ${args.reason || "config update"}`);
              auditLog(db, c, "assistant.config-update", `AI assistant updated config: ${args.reason}`, id);
              actions.push({ tool: "update_config", args, result: "Config updated successfully" });
              result = "Config updated successfully. The new config has been written and a snapshot was created.";
              break;
            }
            case "get_status": {
              if (inst.connection.status === "connected") {
                result = JSON.stringify({ running: true, source: "websocket" });
              } else {
                try {
                  const port = parsePort(inst);
                  const status = await getProcessStatus(exec, port);
                  result = JSON.stringify(status);
                } catch {
                  result = JSON.stringify({ running: false });
                }
              }
              break;
            }
            case "restart_instance": {
              const { restartProcess } = await import("../lifecycle/service.js");
              const port = parsePort(inst);
              await restartProcess(exec, configDir, port, profile!);
              auditLog(db, c, "assistant.restart", "AI assistant triggered restart", id);
              actions.push({ tool: "restart_instance", args: {}, result: "Instance restarted" });
              result = "Instance restart triggered successfully.";
              break;
            }
            default:
              result = `Unknown tool: ${tc.function.name}`;
          }
          }
        } catch (err: any) {
          result = `Error: ${err.message}`;
        }

        messages.push({ role: "tool", content: result, tool_call_id: tc.id });
      }
    }

    // If we exhausted rounds, return whatever we have
    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    return c.json({
      reply: lastAssistant?.content || "I ran into complexity. Please try a simpler request.",
      actions,
    });
  });

  return app;
}

function parsePort(inst: any): number {
  try {
    const url = new URL(inst.connection.url.replace("ws://", "http://"));
    return parseInt(url.port) || 18789;
  } catch {
    return 18789;
  }
}
