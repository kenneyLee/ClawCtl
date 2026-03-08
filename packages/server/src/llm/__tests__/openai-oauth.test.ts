import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOAuthStatus,
  clearOAuthFlow,
  submitManualCode,
  startOpenAIOAuth,
  refreshOpenAIToken,
} from "../openai-oauth.js";

describe("OpenAI OAuth", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearOAuthFlow();
  });

  afterEach(() => {
    clearOAuthFlow();
    global.fetch = originalFetch;
  });

  // --- Status management ---

  it("getOAuthStatus returns none initially", () => {
    expect(getOAuthStatus()).toEqual({ status: "none" });
  });

  it("clearOAuthFlow when no flow does nothing", () => {
    expect(() => clearOAuthFlow()).not.toThrow();
  });

  it("submitManualCode without pending flow returns false", () => {
    expect(submitManualCode("some-code")).toBe(false);
  });

  // --- refreshOpenAIToken ---

  it("refreshOpenAIToken success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "acc_123",
        refresh_token: "ref_456",
        expires_in: 3600,
      }),
    });

    const creds = await refreshOpenAIToken("old_refresh");
    expect(creds.accessToken).toBe("acc_123");
    expect(creds.refreshToken).toBe("ref_456");
    expect(typeof creds.expiresAt).toBe("number");

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    expect(opts.method).toBe("POST");
    expect(opts.body).toContain("grant_type=refresh_token");
    expect(opts.body).toContain("refresh_token=old_refresh");
  });

  it("refreshOpenAIToken failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshOpenAIToken("bad_token")).rejects.toThrow("Token refresh failed");
  });

  it("refreshOpenAIToken missing fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(refreshOpenAIToken("some_token")).rejects.toThrow("missing required fields");
  });

  it("refreshOpenAIToken expiresAt calculation", async () => {
    const before = Date.now();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
      }),
    });

    const creds = await refreshOpenAIToken("tok");
    const after = Date.now();

    expect(creds.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(creds.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  // --- startOpenAIOAuth + callback flow ---

  it("startOpenAIOAuth returns authUrl with correct params", async () => {
    const { authUrl } = await startOpenAIOAuth();
    const url = new URL(authUrl);

    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  it("startOpenAIOAuth sets status to waiting_auth", async () => {
    await startOpenAIOAuth();
    expect(getOAuthStatus().status).toBe("waiting_auth");
  });

  it("clearOAuthFlow after start resets to none", async () => {
    await startOpenAIOAuth();
    expect(getOAuthStatus().status).toBe("waiting_auth");
    clearOAuthFlow();
    expect(getOAuthStatus().status).toBe("none");
  });

  // --- submitManualCode ---

  it("submitManualCode with redirect URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "acc",
        refresh_token: "ref",
        expires_in: 3600,
      }),
    });

    await startOpenAIOAuth();
    const result = submitManualCode(
      "http://localhost:1455/auth/callback?code=test_code_123&state=xyz",
    );
    expect(result).toBe(true);
  });

  it("submitManualCode with raw code string", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "acc",
        refresh_token: "ref",
        expires_in: 3600,
      }),
    });

    await startOpenAIOAuth();
    const result = submitManualCode("raw_auth_code_456");
    expect(result).toBe(true);
  });
});
