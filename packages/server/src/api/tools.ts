import { Hono } from "hono";
import type { InstanceManager } from "../instances/manager.js";
import type { LlmClient } from "../llm/client.js";
import { requireWrite } from "../auth/middleware.js";

export function toolRoutes(manager: InstanceManager, llm: LlmClient) {
  const app = new Hono();

  app.get("/:id/agents/:agentId/tools", async (c) => {
    const client = manager.getClient(c.req.param("id"));
    if (!client) return c.json({ error: "instance not found" }, 404);
    const tools = await client.fetchToolsForAgent(c.req.param("agentId"));
    return c.json(tools);
  });

  app.get("/matrix", (c) => {
    const all = manager.getAll();
    const matrix = all.map((inst) => ({
      instanceId: inst.id,
      label: inst.connection.label,
      agents: inst.agents.map((a) => ({
        agentId: a.id,
        toolsAllow: a.toolsAllow || [],
      })),
    }));
    return c.json(matrix);
  });

  app.post("/diagnose", requireWrite("tools"), async (c) => {
    const { instanceId, agentId, toolName } = await c.req.json<{
      instanceId: string; agentId: string; toolName: string;
    }>();

    const info = manager.get(instanceId);
    if (!info) return c.json({ error: "instance not found" }, 404);

    const agent = info.agents.find((a) => a.id === agentId);
    const steps: { check: string; pass: boolean; detail: string }[] = [];

    steps.push({
      check: "Agent exists",
      pass: !!agent,
      detail: agent ? `Agent "${agentId}" found` : `Agent "${agentId}" not found in instance`,
    });

    if (agent) {
      const allowList = agent.toolsAllow || [];
      const query = toolName.toLowerCase();

      if (allowList.length === 0) {
        // No explicit allow list means all tools permitted
        steps.push({
          check: "Tool access",
          pass: true,
          detail: `Agent has no tools.allow restriction — all tools are permitted`,
        });
      } else {
        // Fuzzy match: exact first, then substring
        const exactMatch = allowList.find((t) => t.toLowerCase() === query);
        const fuzzyMatches = allowList.filter((t) => t.toLowerCase().includes(query));

        if (exactMatch) {
          steps.push({
            check: "Tool in agent's tools.allow",
            pass: true,
            detail: `"${exactMatch}" is in tools.allow (exact match)`,
          });
        } else if (fuzzyMatches.length > 0) {
          steps.push({
            check: "Tool in agent's tools.allow",
            pass: true,
            detail: `Found ${fuzzyMatches.length} matching tool(s): ${fuzzyMatches.join(", ")}`,
          });
        } else {
          steps.push({
            check: "Tool in agent's tools.allow",
            pass: false,
            detail: `"${toolName}" is NOT in tools.allow (${allowList.length} tools checked). Add it to enable this tool for the agent.`,
          });
        }
      }

      // Also check tool catalog if available
      try {
        const client = manager.getClient(instanceId);
        if (client) {
          const catalog = await client.fetchToolsForAgent(agentId);
          const catalogMatch = catalog.filter((t) =>
            t.name.toLowerCase().includes(query) || (t.description || "").toLowerCase().includes(query)
          );
          if (catalogMatch.length > 0) {
            steps.push({
              check: "Tool in catalog",
              pass: true,
              detail: `Found in catalog: ${catalogMatch.map((t) => `${t.name} (${t.category})`).join(", ")}`,
            });
          } else if (catalog.length > 0) {
            steps.push({
              check: "Tool in catalog",
              pass: false,
              detail: `"${toolName}" not found in tool catalog (${catalog.length} tools available)`,
            });
          }
        }
      } catch { /* catalog fetch optional */ }
    }

    let suggestion: string | undefined;
    if (llm.isConfigured() && steps.some((s) => !s.pass)) {
      try {
        const result = await llm.complete({
          system: "You are an OpenClaw admin assistant. Given diagnostic results, suggest a fix.",
          prompt: `Tool "${toolName}" diagnostic for agent "${agentId}":\n${JSON.stringify(steps, null, 2)}`,
          maxTokens: 200,
        });
        suggestion = result.text;
      } catch { /* LLM optional */ }
    }

    return c.json({ steps, suggestion });
  });

  return app;
}
