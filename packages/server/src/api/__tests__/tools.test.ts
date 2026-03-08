import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { toolRoutes } from "../tools.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Tools API routes", () => {
  let app: Hono;
  let manager: MockInstanceManager;
  let llm: LlmClient;

  beforeEach(() => {
    manager = new MockInstanceManager();
    manager.seed([makeInstanceInfo()]);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/tools", toolRoutes(manager as any, llm));
  });

  it("GET /:id/agents/:agentId/tools returns tool list", async () => {
    const res = await app.request("/tools/test-1/agents/main/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
  });

  it("GET /:id/agents/:agentId/tools returns 404 for missing", async () => {
    const res = await app.request("/tools/nope/agents/main/tools");
    expect(res.status).toBe(404);
  });

  it("GET /matrix returns cross-instance matrix", async () => {
    const res = await app.request("/tools/matrix");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].agents).toHaveLength(2);
  });

  it("POST /diagnose with valid agent shows pass", async () => {
    const res = await app.request("/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "test-1", agentId: "main", toolName: "exec" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps[0].pass).toBe(true);
    expect(data.steps[1].pass).toBe(true);
  });

  it("POST /diagnose tool not in allow shows fail", async () => {
    const res = await app.request("/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "test-1", agentId: "bhpc", toolName: "exec" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps[0].pass).toBe(true);
    expect(data.steps[1].pass).toBe(false);
  });

  it("POST /diagnose missing agent", async () => {
    const res = await app.request("/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "test-1", agentId: "nonexistent", toolName: "exec" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps[0].pass).toBe(false);
  });

  it("POST /diagnose missing instance returns 404", async () => {
    const res = await app.request("/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "nope", agentId: "main", toolName: "exec" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /diagnose LLM unconfigured still returns steps without suggestion", async () => {
    const res = await app.request("/tools/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "test-1", agentId: "bhpc", toolName: "exec" }),
    });
    const data = await res.json();
    expect(data.steps).toBeDefined();
    expect(data.suggestion).toBeUndefined();
  });
});
