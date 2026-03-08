import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GatewayClient } from "../gateway/client.js";

const LIVE_URL = process.env.CLAWCTL_LIVE_URL;
const LIVE_TOKEN = process.env.CLAWCTL_LIVE_TOKEN;

describe.skipIf(!LIVE_URL)("Live Gateway tests", () => {
  let client: GatewayClient;

  beforeAll(async () => {
    client = new GatewayClient({
      id: "live-test",
      url: LIVE_URL!,
      token: LIVE_TOKEN,
      status: "disconnected",
    });
    await client.connect();
  });

  afterAll(() => {
    client?.disconnect();
  });

  it("connects successfully", () => {
    expect(client.conn.status).toBe("connected");
  });

  it("fetchHealth returns valid data", async () => {
    const health = await client.fetchHealth();
    expect(["ok", "degraded"]).toContain(health.status);
  });

  it("fetchAgents returns non-empty array", async () => {
    const agents = await client.fetchAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("id");
  });

  it("fetchChannels returns array", async () => {
    const channels = await client.fetchChannels();
    expect(Array.isArray(channels)).toBe(true);
  });

  it("fetchSessions returns array", async () => {
    const sessions = await client.fetchSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("fetchSkills returns array", async () => {
    const skills = await client.fetchSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  it("fetchConfig returns object", async () => {
    const config = await client.fetchConfig();
    expect(typeof config).toBe("object");
  });

  it("fetchSecurityAudit returns array", async () => {
    const audit = await client.fetchSecurityAudit();
    expect(Array.isArray(audit)).toBe(true);
  });

  it("fetchFullInstance aggregates all data", async () => {
    const info = await client.fetchFullInstance();
    expect(info.id).toBe("live-test");
    expect(info.agents).toBeDefined();
    expect(info.channels).toBeDefined();
    expect(info.sessions).toBeDefined();
  });
});
