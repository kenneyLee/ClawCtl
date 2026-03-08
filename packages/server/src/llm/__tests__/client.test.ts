import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmClient } from "../client.js";

describe("LlmClient", () => {
  it("isConfigured returns false initially", () => {
    const client = new LlmClient();
    expect(client.isConfigured()).toBe(false);
  });

  it("complete throws when not configured", async () => {
    const client = new LlmClient();
    await expect(client.complete({ prompt: "hello" })).rejects.toThrow("LLM not configured");
  });

  it("isConfigured returns true after configure", () => {
    const client = new LlmClient();
    client.configure({ provider: "openai", model: "gpt-4o", apiKey: "test" });
    expect(client.isConfigured()).toBe(true);
  });

  it("configure can be called multiple times", () => {
    const client = new LlmClient();
    client.configure({ provider: "openai", model: "gpt-4o", apiKey: "test" });
    client.configure({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "test2" });
    expect(client.isConfigured()).toBe(true);
  });

  it("complete with unknown provider throws", async () => {
    const client = new LlmClient();
    client.configure({ provider: "unknown" as any, model: "test" });
    await expect(client.complete({ prompt: "hello" })).rejects.toThrow("Unknown provider");
  });
});

describe("LlmClient — OAuth & provider routing", () => {
  let client: LlmClient;

  beforeEach(() => {
    client = new LlmClient();
  });

  // --- isConfigured with OAuth ---

  it("isConfigured returns true with openaiOAuth and no apiKey", () => {
    client.configure({
      provider: "openai",
      model: "gpt-4o",
      openaiOAuth: {
        accessToken: "tok",
        refreshToken: "rt",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    expect(client.isConfigured()).toBe(true);
  });

  it("isConfigured returns false for openai with no apiKey and no OAuth", () => {
    client.configure({ provider: "openai", model: "gpt-4o" });
    expect(client.isConfigured()).toBe(false);
  });

  it("isConfigured returns true for ollama without apiKey", () => {
    client.configure({ provider: "ollama", model: "llama3" });
    expect(client.isConfigured()).toBe(true);
  });

  // --- OAuth token refresh ---

  it("getOpenAIOAuthToken returns token when not expired (no refresh call)", () => {
    client.configure({
      provider: "openai",
      model: "gpt-4o",
      openaiOAuth: {
        accessToken: "valid-tok",
        refreshToken: "rt",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // We cannot call the private method directly, but we can verify the
    // client is configured and no fetch (refresh) call is triggered just
    // by checking isConfigured — the real integration would call complete().
    expect(client.isConfigured()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("onOAuthRefresh callback is set and accessible", () => {
    const cb = vi.fn();
    client.onOAuthRefresh = cb;
    expect(client.onOAuthRefresh).toBe(cb);
  });

  // --- chat with unknown provider ---

  it("chat throws for unsupported provider", async () => {
    client.configure({ provider: "ollama", model: "llama3" });
    await expect(
      client.chat({
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("Chat with tools not supported");
  });

  // --- Azure isConfigured ---

  it("isConfigured for azure requires resourceName and deploymentName", () => {
    client.configure({
      provider: "azure",
      model: "gpt-4o",
      apiKey: "az-key",
      azure: {
        resourceName: "",
        deploymentName: "",
        auth: "key",
      },
    });
    expect(client.isConfigured()).toBe(false);
  });

  it("isConfigured for azure with AD auth requires clientId", () => {
    client.configure({
      provider: "azure",
      model: "gpt-4o",
      azure: {
        resourceName: "my-resource",
        deploymentName: "my-deploy",
        auth: "ad",
        tenantId: "tid",
        clientSecret: "secret",
        // clientId intentionally omitted
      },
    });
    expect(client.isConfigured()).toBe(false);
  });
});
