import type Database from "better-sqlite3";

export interface PermissionTemplate {
  id: string;
  name: string;
  description: string;
  preset: boolean;
  config: {
    toolsAllow: string[];
    execSecurity: "allowlist" | "full" | "disabled";
    workspaceOnly: boolean;
  };
}

export interface TemplateDiff {
  agentName: string;
  before: Record<string, any>;
  after: Record<string, any>;
}

const PRESETS: PermissionTemplate[] = [
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Restrictive preset for enterprise environments: read-only tools, allowlist execution, workspace-scoped.",
    preset: true,
    config: {
      toolsAllow: ["read", "search", "list"],
      execSecurity: "allowlist",
      workspaceOnly: true,
    },
  },
  {
    id: "social",
    name: "Social",
    description: "Moderate preset for social/community use: common tools enabled, full execution, no workspace restriction.",
    preset: true,
    config: {
      toolsAllow: ["read", "search", "list", "write", "exec"],
      execSecurity: "full",
      workspaceOnly: false,
    },
  },
  {
    id: "personal",
    name: "Personal",
    description: "Permissive preset for personal use: all tools allowed, full execution, no workspace restriction.",
    preset: true,
    config: {
      toolsAllow: ["*"],
      execSecurity: "full",
      workspaceOnly: false,
    },
  },
];

const PRESET_IDS = new Set(PRESETS.map((p) => p.id));

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  config_json: string;
  created_at: string;
}

export class PermissionTemplateStore {
  constructor(private db: Database.Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        config_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  listPresets(): PermissionTemplate[] {
    return PRESETS;
  }

  listCustom(): PermissionTemplate[] {
    const rows = this.db
      .prepare("SELECT id, name, description, config_json FROM permission_templates ORDER BY created_at")
      .all() as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  listAll(): PermissionTemplate[] {
    return [...PRESETS, ...this.listCustom()];
  }

  getTemplate(id: string): PermissionTemplate | undefined {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) return preset;
    const row = this.db
      .prepare("SELECT id, name, description, config_json FROM permission_templates WHERE id = ?")
      .get(id) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : undefined;
  }

  applyToAgent(templateId: string, agentConfig: Record<string, any>): TemplateDiff {
    const template = this.getTemplate(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    const before = {
      toolsAllow: agentConfig.tools?.allow,
      execSecurity: agentConfig.tools?.exec?.security,
      workspaceOnly: agentConfig.workspace !== undefined,
    };
    const after = {
      toolsAllow: template.config.toolsAllow,
      execSecurity: template.config.execSecurity,
      workspaceOnly: template.config.workspaceOnly,
    };
    return {
      agentName: agentConfig.name || agentConfig.id || "unknown",
      before,
      after,
    };
  }

  createCustom(template: {
    id: string;
    name: string;
    description?: string;
    config: PermissionTemplate["config"];
  }): PermissionTemplate {
    this.db
      .prepare("INSERT INTO permission_templates (id, name, description, config_json) VALUES (?, ?, ?, ?)")
      .run(template.id, template.name, template.description ?? null, JSON.stringify(template.config));
    return {
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      preset: false,
      config: template.config,
    };
  }

  updateCustom(
    id: string,
    updates: Partial<{ name: string; description: string; config: PermissionTemplate["config"] }>
  ): PermissionTemplate | undefined {
    if (PRESET_IDS.has(id)) return undefined;

    const existing = this.db
      .prepare("SELECT id, name, description, config_json FROM permission_templates WHERE id = ?")
      .get(id) as TemplateRow | undefined;
    if (!existing) return undefined;

    const name = updates.name ?? existing.name;
    const description = updates.description ?? existing.description ?? "";
    const configJson = updates.config ? JSON.stringify(updates.config) : existing.config_json;

    this.db
      .prepare("UPDATE permission_templates SET name = ?, description = ?, config_json = ? WHERE id = ?")
      .run(name, description, configJson, id);

    return {
      id,
      name,
      description,
      preset: false,
      config: updates.config ?? JSON.parse(existing.config_json),
    };
  }

  deleteCustom(id: string): boolean {
    if (PRESET_IDS.has(id)) return false;
    const info = this.db.prepare("DELETE FROM permission_templates WHERE id = ?").run(id);
    return info.changes > 0;
  }
}

function rowToTemplate(row: TemplateRow): PermissionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    preset: false,
    config: JSON.parse(row.config_json),
  };
}
