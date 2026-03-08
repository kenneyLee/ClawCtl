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
  workspace: string;
  workspaceOnly: boolean;
  fsWorkspaceOnly: boolean;
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
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.list) config.agents.list = [];

  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  config.agents.defaults.model.primary = payload.defaults.model;
  config.agents.defaults.thinkingDefault = payload.defaults.thinkingDefault;

  const existingMap = new Map<string, any>();
  for (const a of config.agents.list) {
    existingMap.set(a.id, a);
  }

  config.agents.list = payload.agents.map((input) => {
    const existing = existingMap.get(input.id);
    if (existing) {
      existing.model = { ...existing.model, primary: input.model };
      if (input.thinkingDefault) {
        existing.thinkingDefault = input.thinkingDefault;
      } else {
        delete existing.thinkingDefault;
      }
      if (input.workspace) {
        existing.workspace = input.workspace;
      } else {
        delete existing.workspace;
      }
      if (!existing.tools) existing.tools = {};
      existing.tools.allow = input.toolsAllow;
      if (input.execSecurity) {
        if (!existing.tools.exec) existing.tools.exec = {};
        existing.tools.exec.security = input.execSecurity;
        if (!existing.tools.exec.applyPatch) existing.tools.exec.applyPatch = {};
        existing.tools.exec.applyPatch.workspaceOnly = input.workspaceOnly;
      }
      if (!existing.tools.fs) existing.tools.fs = {};
      existing.tools.fs.workspaceOnly = input.fsWorkspaceOnly;
      return existing;
    }
    const entry: any = { id: input.id, model: { primary: input.model } };
    if (input.thinkingDefault) entry.thinkingDefault = input.thinkingDefault;
    if (input.workspace) entry.workspace = input.workspace;
    const tools: any = { allow: input.toolsAllow };
    if (input.execSecurity) {
      tools.exec = { security: input.execSecurity, applyPatch: { workspaceOnly: input.workspaceOnly } };
    }
    tools.fs = { workspaceOnly: input.fsWorkspaceOnly };
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
  if (Array.isArray(config.bindings)) {
    config.bindings = config.bindings.filter((b: any) => b.agentId !== agentId);
  }
  return config;
}
