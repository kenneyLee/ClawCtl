import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "../client.js";
import { createMockGateway, type MockGateway } from "../../__tests__/helpers/mock-ws-server.js";
import { MOCK_RPC_RESPONSES } from "../../__tests__/helpers/fixtures.js";

describe("GatewayClient", () => {
  let gw: MockGateway;

  beforeEach(async () => {
    gw = await createMockGateway();
    for (const [method, result] of Object.entries(MOCK_RPC_RESPONSES)) {
      gw.onRpc(method, () => result);
    }
  });

  afterEach(async () => {
    await gw.close();
  });

  it("initializes with disconnected status", () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    expect(client.conn.status).toBe("disconnected");
  });

  it("connects successfully to mock server", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    expect(client.conn.status).toBe("connected");
    client.disconnect();
  });

  it("sets status to error on connection failure", async () => {
    const client = new GatewayClient({ id: "test", url: "ws://127.0.0.1:1", status: "disconnected" });
    await expect(client.connect()).rejects.toThrow();
    expect(client.conn.status).toBe("error");
  });

  it("disconnect sets status to disconnected", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    client.disconnect();
    expect(client.conn.status).toBe("disconnected");
  });

  it("rpc throws when not connected", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await expect(client.rpc("agents.list")).rejects.toThrow("Not connected");
  });

  it("rpc resolves with payload from server", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const result = await client.rpc("agents.list", {});
    expect(result.agents).toHaveLength(2);
    client.disconnect();
  });

  it("rpc rejects when server returns error", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    await expect(client.rpc("nonexistent.method")).rejects.toThrow("Method not found");
    client.disconnect();
  });

  it("fetchHealth returns ok when connected", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const health = await client.fetchHealth();
    expect(health.status).toBe("ok");
    expect(health.version).toBe("1.0.0-mock");
    client.disconnect();
  });

  it("fetchAgents maps response correctly", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const agents = await client.fetchAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].id).toBe("main");
    expect(agents[0].model).toBe("gpt-4o");
    expect(agents[0].toolsAllow).toEqual(["exec", "search"]);
    client.disconnect();
  });

  it("fetchChannels maps response correctly", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const channels = await client.fetchChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].type).toBe("feishu");
    expect(channels[0].running).toBe(true);
    client.disconnect();
  });

  it("fetchSessions maps response correctly", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const sessions = await client.fetchSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].key).toBe("session-1");
    client.disconnect();
  });

  it("fetchSkills maps response correctly", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const skills = await client.fetchSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("web-search");
    client.disconnect();
  });

  it("fetchConfig maps response correctly", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const config = await client.fetchConfig();
    expect(config).toHaveProperty("gateway");
    client.disconnect();
  });

  it("fetchSecurityAudit derives from config", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const audit = await client.fetchSecurityAudit();
    // Config has auth.token set, so no warnings
    expect(audit).toHaveLength(0);
    client.disconnect();
  });

  it("fetchSessionHistory returns messages", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const messages = await client.fetchSessionHistory("session-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    client.disconnect();
  });

  it("fetchFullInstance aggregates all data", async () => {
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const info = await client.fetchFullInstance();
    expect(info.id).toBe("test");
    expect(info.health?.status).toBe("ok");
    expect(info.agents).toHaveLength(2);
    expect(info.channels).toHaveLength(1);
    expect(info.sessions).toHaveLength(1);
    expect(info.skills).toHaveLength(1);
    client.disconnect();
  });

  it("fetchFullInstance handles partial RPC failures gracefully", async () => {
    gw.onRpc("skills.status", () => { throw new Error("fail"); });
    const client = new GatewayClient({ id: "test", url: gw.url, status: "disconnected" });
    await client.connect();
    const info = await client.fetchFullInstance();
    expect(info.skills).toEqual([]);
    expect(info.agents).toHaveLength(2);
    client.disconnect();
  });
});
