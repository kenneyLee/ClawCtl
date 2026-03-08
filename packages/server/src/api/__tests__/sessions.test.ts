import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { sessionRoutes } from "../sessions.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Session API routes", () => {
  let app: Hono;
  let manager: MockInstanceManager;
  let llm: LlmClient;

  beforeEach(() => {
    manager = new MockInstanceManager();
    manager.seed([makeInstanceInfo()]);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/instances", sessionRoutes(manager as any, llm));
  });

  it("GET /:id/sessions returns session list", async () => {
    const res = await app.request("/instances/test-1/sessions");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
  });

  it("GET /:id/sessions returns 404 for missing instance", async () => {
    const res = await app.request("/instances/nope/sessions");
    expect(res.status).toBe(404);
  });

  it("GET /:id/sessions/:key returns messages", async () => {
    const res = await app.request("/instances/test-1/sessions/session-1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("POST /:id/sessions/:key/summarize returns 400 when LLM not configured", async () => {
    const res = await app.request("/instances/test-1/sessions/session-1/summarize", { method: "POST" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("LLM not configured");
  });

  it("POST /:id/sessions/:key/summarize returns 404 for missing instance", async () => {
    llm.configure({ provider: "openai", model: "gpt-4o", apiKey: "fake" });
    const res = await app.request("/instances/nope/sessions/s1/summarize", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
