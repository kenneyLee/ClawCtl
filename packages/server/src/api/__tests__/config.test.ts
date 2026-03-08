import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { configRoutes } from "../config.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";

describe("Config API routes", () => {
  let app: Hono;
  let manager: MockInstanceManager;

  beforeEach(() => {
    manager = new MockInstanceManager();
    manager.seed([
      makeInstanceInfo({ id: "inst-a", connection: { id: "inst-a", url: "ws://a", status: "connected", label: "A" } }),
      makeInstanceInfo({ id: "inst-b", connection: { id: "inst-b", url: "ws://b", status: "connected", label: "B" } }),
    ]);
    app = new Hono();
    app.route("/instances", configRoutes(manager as any));
  });

  it("GET /:id/config returns config object", async () => {
    const res = await app.request("/instances/inst-a/config");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("gateway");
  });

  it("GET /:id/config returns 404 for missing", async () => {
    const res = await app.request("/instances/nope/config");
    expect(res.status).toBe(404);
  });

  it("POST /compare returns two configs", async () => {
    const res = await app.request("/instances/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceA: "inst-a", instanceB: "inst-b" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("a");
    expect(data).toHaveProperty("b");
  });

  it("POST /compare returns 404 when instance missing", async () => {
    const res = await app.request("/instances/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceA: "inst-a", instanceB: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});
