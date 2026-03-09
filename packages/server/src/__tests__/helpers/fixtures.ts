import type { InstanceInfo, GatewayConnection } from "../../gateway/types.js";

export function makeConnection(overrides?: Partial<GatewayConnection>): GatewayConnection {
  return {
    id: "test-1",
    url: "ws://127.0.0.1:9999",
    status: "disconnected",
    label: "Test Instance",
    ...overrides,
  };
}

export function makeInstanceInfo(overrides?: Partial<InstanceInfo>): InstanceInfo {
  return {
    id: "test-1",
    connection: makeConnection({ status: "connected" }),
    agents: [
      { id: "main", name: "main", model: "gpt-4o", toolsAllow: ["exec", "search"], isDefault: true },
      { id: "bhpc", name: "bhpc", model: "gpt-4o", toolsAllow: ["search"] },
    ],
    channels: [
      { type: "feishu", enabled: true, running: true, configured: true },
    ],
    sessions: [
      { key: "session-1", kind: "direct", model: "gpt-4o", totalTokens: 1000 },
    ],
    skills: [
      { name: "web-search", status: "ready", description: "Web search" },
      { name: "code-review", status: "missing" },
    ],
    config: { gateway: { port: 18789 }, agents: {} },
    securityAudit: [
      { level: "critical", title: "Open group policy", detail: "Groups have full access", fix: "Restrict" },
      { level: "warn", title: "Elevated tools", detail: "exec enabled for main agent" },
    ],
    ...overrides,
  };
}

export const MOCK_RPC_RESPONSES: Record<string, any> = {
  "agents.list": {
    defaultId: "main",
    agents: [
      { id: "main", name: "main" },
      { id: "bhpc", name: "bhpc" },
    ],
  },
  "channels.status": {
    channelOrder: ["feishu"],
    channelLabels: { feishu: "Feishu" },
    channelAccounts: {
      feishu: [
        { accountId: "abc", enabled: true, running: true, configured: true },
      ],
    },
    channelDefaultAccountId: { feishu: "abc" },
  },
  "sessions.list": {
    sessions: [
      { key: "session-1", kind: "direct", model: "gpt-4o", totalTokens: 1000 },
    ],
  },
  "skills.status": {
    skills: [
      { name: "web-search", eligible: true, disabled: false, description: "Web search", source: "community" },
    ],
  },
  "config.get": { gateway: { port: 18789, auth: { token: "mock-token" } }, agents: {} },
  "tools.catalog": {
    agentId: "main",
    profiles: [],
    groups: [
      {
        id: "runtime",
        label: "Runtime",
        source: "core",
        tools: [
          { id: "exec", label: "Execute", description: "Execute commands", source: "core" },
        ],
      },
    ],
  },
  "chat.history": {
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there! How can I help?" },
    ],
  },
};
