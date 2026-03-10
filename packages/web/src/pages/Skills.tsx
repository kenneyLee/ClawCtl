import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search, X } from "lucide-react";
import {
  Wrench, Megaphone, Palette, BarChart3, Users, Home,
  Cpu, ClipboardList, Zap, Headphones, TrendingUp,
  Database, MessageCircle, Building, Brain,
} from "lucide-react";
import { useInstances } from "../hooks/useInstances";
import { get, post } from "../lib/api";

// ─── Types ───

interface SkillCatalogEntry {
  name: string;
  description: string;
  source: "bundled" | "clawhub";
  emoji?: string;
  category: string;
  tags: string[];
  author?: string;
  downloads?: number;
  homepage?: string;
  requires?: { bins?: string[]; env?: string[]; os?: string[] };
}

interface SkillEntry {
  name: string;
  source: "bundled" | "clawhub";
  note: string;
}

interface SkillTemplate {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  description_zh: string;
  icon: string;
  skills: SkillEntry[];
  builtin: number;
  sort_order: number;
}

// ─── Icon map ───

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  wrench: Wrench,
  megaphone: Megaphone,
  palette: Palette,
  "bar-chart": BarChart3,
  users: Users,
  home: Home,
  cpu: Cpu,
  "clipboard-list": ClipboardList,
  zap: Zap,
  headphones: Headphones,
  "trending-up": TrendingUp,
  database: Database,
  "message-circle": MessageCircle,
  building: Building,
  brain: Brain,
};

function getIconComponent(name: string) {
  return ICON_MAP[name] || null;
}

// ─── SkillCard ───

function SkillCard({ skill, onInstall, t }: { skill: SkillCatalogEntry; onInstall: () => void; t: (k: string) => string }) {
  return (
    <div className="bg-s1 border border-edge rounded-lg p-4 hover:border-brand/30 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{skill.emoji || "\uD83D\uDCE6"}</span>
        <span className="text-xs text-ink-3 bg-s2 px-2 py-0.5 rounded">
          {t(`skills.categories.${skill.category}`)}
        </span>
      </div>
      <h3 className="text-sm font-medium text-ink mb-1">{skill.name}</h3>
      <p className="text-xs text-ink-3 mb-3 line-clamp-2">{skill.description}</p>
      <button
        onClick={onInstall}
        className="w-full text-xs bg-brand/10 text-brand hover:bg-brand/20 py-1.5 rounded transition-colors"
      >
        {t("skills.install")}
      </button>
    </div>
  );
}

// ─── TemplateCard ───

function TemplateCard({ tpl, onInstall, t, lang }: {
  tpl: SkillTemplate;
  onInstall: () => void;
  t: (k: string) => string;
  lang: string;
}) {
  const name = lang === "zh" ? tpl.name_zh : tpl.name;
  const desc = lang === "zh" ? tpl.description_zh : tpl.description;
  const Icon = getIconComponent(tpl.icon);
  return (
    <div className="bg-s1 border border-edge rounded-lg p-4 hover:border-brand/30 transition-colors min-w-[200px]">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={18} className="text-brand" />}
        <h3 className="text-sm font-medium text-ink">{name}</h3>
      </div>
      <p className="text-xs text-ink-3 mb-2">{desc}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-3">{tpl.skills.length} {t("skills.skills")}</span>
        <button
          onClick={onInstall}
          className="text-xs bg-brand/10 text-brand hover:bg-brand/20 px-3 py-1 rounded transition-colors"
        >
          {t("skills.installAll")}
        </button>
      </div>
    </div>
  );
}

// ─── InstallDialog ───

interface InstallTarget {
  skills: { name: string; source: string }[];
}

function InstallDialog({ skills, instances, onClose, t }: {
  skills: { name: string; source: string }[];
  instances: { id: string; connection: { id: string; label?: string; status: string }; agents: { id: string; name?: string }[] }[];
  onClose: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const [selections, setSelections] = useState<Map<string, Set<string>>>(new Map());
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectedInstances = instances.filter((inst) => inst.connection.status === "connected");

  const toggleAgent = (instanceId: string, agentId: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(instanceId) || []);
      if (set.has(agentId)) set.delete(agentId);
      else set.add(agentId);
      if (set.size === 0) next.delete(instanceId);
      else next.set(instanceId, set);
      return next;
    });
  };

  const toggleAll = (instanceId: string, agents: { id: string }[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const existing = next.get(instanceId);
      if (existing && existing.size === agents.length) {
        next.delete(instanceId);
      } else {
        next.set(instanceId, new Set(agents.map((a) => a.id)));
      }
      return next;
    });
  };

  const totalAgents = Array.from(selections.values()).reduce((sum, s) => sum + s.size, 0);

  const handleConfirm = async () => {
    if (totalAgents === 0) return;
    setInstalling(true);
    setError(null);
    try {
      const targets = Array.from(selections.entries()).map(([instanceId, agentIds]) => ({
        instanceId,
        agentIds: Array.from(agentIds),
      }));
      await post("/skills/install", { skills, targets });
      setResult(t("skills.installDialog.success"));
    } catch (err: any) {
      setError(t("skills.installDialog.failed", { error: err.message || "Unknown error" }));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-s1 border border-edge rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h2 className="text-lg font-semibold text-ink">{t("skills.installDialog.title")}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Skill chips */}
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {skills.map((sk) => (
            <span key={sk.name} className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded">{sk.name}</span>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-sm text-ink-2">{t("skills.installDialog.selectAgents")}</p>

          {connectedInstances.length === 0 ? (
            <p className="text-sm text-ink-3">{t("skills.installDialog.noInstances")}</p>
          ) : (
            connectedInstances.map((inst) => (
              <div key={inst.id} className="border border-edge rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-ink">{inst.connection.label || inst.id}</span>
                  <button
                    onClick={() => toggleAll(inst.id, inst.agents)}
                    className="text-xs text-brand hover:text-brand-light transition-colors"
                  >
                    {t("skills.installDialog.selectAll")}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {inst.agents.map((agent) => {
                    const checked = selections.get(inst.id)?.has(agent.id) || false;
                    return (
                      <label key={agent.id} className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer hover:text-ink transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAgent(inst.id, agent.id)}
                          className="accent-brand"
                        />
                        {agent.name || agent.id}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {result && (
            <div className="p-3 bg-ok/10 border border-ok/30 rounded-lg text-sm text-ok">{result}</div>
          )}
          {error && (
            <div className="p-3 bg-danger-dim border border-danger/30 rounded-lg text-sm text-danger">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:text-ink transition-colors">
            {t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={totalAgents === 0 || installing || !!result}
            className="px-4 py-2 bg-brand hover:bg-brand-light rounded-lg text-sm text-white font-medium disabled:opacity-50 transition-colors"
          >
            {installing
              ? t("skills.installDialog.installing")
              : t("skills.installDialog.confirm", { count: totalAgents })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Skills Page ───

export function Skills() {
  const { t, i18n } = useTranslation();
  const { instances } = useInstances();
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const fetchData = useCallback(() => {
    setLoadingCatalog(true);
    Promise.all([
      get<{ bundled: SkillCatalogEntry[]; tags: string[]; categories: string[] }>("/skills"),
      get<{ templates: SkillTemplate[] }>("/skills/templates"),
    ])
      .then(([catalogRes, templatesRes]) => {
        setCatalog(catalogRes.bundled);
        setCategories(catalogRes.categories as unknown as string[]);
        setTemplates(templatesRes.templates);
      })
      .catch(() => {})
      .finally(() => setLoadingCatalog(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Client-side filtering
  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return catalog.filter((skill) => {
      if (selectedCategory && skill.category !== selectedCategory) return false;
      if (lowerSearch) {
        const inName = skill.name.toLowerCase().includes(lowerSearch);
        const inDesc = skill.description.toLowerCase().includes(lowerSearch);
        const inTags = skill.tags.some((tag) => tag.toLowerCase().includes(lowerSearch));
        if (!inName && !inDesc && !inTags) return false;
      }
      return true;
    });
  }, [catalog, search, selectedCategory]);

  const visibleTemplates = showAllTemplates ? templates : templates.slice(0, 4);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("skills.title")}</h1>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink transition-colors"
        >
          <RefreshCw size={16} />
          {t("common.refresh")}
        </button>
      </div>

      {/* Search + Category filter */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("skills.searchPlaceholder")}
            className="w-full bg-s1 border border-edge rounded-lg pl-9 pr-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-s1 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink"
        >
          <option value="">{t("skills.allCategories")}</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {t(`skills.categories.${cat}`)}
            </option>
          ))}
        </select>
      </div>

      {loadingCatalog ? (
        <div className="text-sm text-ink-3">{t("common.loading")}</div>
      ) : (
        <>
          {/* Scene Templates */}
          {templates.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-ink">{t("skills.sceneTemplates")}</h2>
                {templates.length > 4 && (
                  <button
                    onClick={() => setShowAllTemplates(!showAllTemplates)}
                    className="text-xs text-brand hover:text-brand-light transition-colors"
                  >
                    {showAllTemplates ? t("skills.showLess") : t("skills.showAll")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {visibleTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    onInstall={() =>
                      setInstallTarget({
                        skills: tpl.skills.map((s) => ({ name: s.name, source: s.source })),
                      })
                    }
                    t={t}
                    lang={i18n.language}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All Skills */}
          <div>
            <h2 className="text-lg font-semibold text-ink mb-3">
              {t("skills.allSkills")} ({filtered.length})
            </h2>
            {filtered.length === 0 ? (
              <div className="text-sm text-ink-3 py-8 text-center">{t("skills.noResults")}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filtered.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    onInstall={() =>
                      setInstallTarget({
                        skills: [{ name: skill.name, source: skill.source }],
                      })
                    }
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Install dialog */}
      {installTarget && (
        <InstallDialog
          skills={installTarget.skills}
          instances={instances}
          onClose={() => setInstallTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}
