import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LlmClient } from "../client.js";

// --- Helpers ---

function makeJwt(payload: any): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

function makeSseResponse(events: any[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\ndata: [DONE]\n\n";
}

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

const ACCOUNT_ID = "acct_123";
const JWT_PAYLOAD = { "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT_ID } };

function makeClient(overrides?: Partial<{ apiKey: string }>): LlmClient {
  const jwt = makeJwt(JWT_PAYLOAD);
  const client = new LlmClient();
  client.configure({
    provider: "openai",
    model: "gpt-5.1-codex",
    ...overrides,
    openaiOAuth: { accessToken: jwt, refreshToken: "rt_xxx", expiresAt: Date.now() + 3600_000 },
  });
  return client;
}

/** Build a response.completed event with text output */
function completedEvent(text: string, usage?: { total_tokens: number }): any {
  return {
    type: "response.completed",
    response: {
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
      usage: usage ?? { total_tokens: 42 },
    },
  };
}

/** Build a response.completed event with function_call output */
function completedWithToolCalls(
  calls: { id: string; name: string; arguments: string }[],
  usage?: { total_tokens: number },
): any {
  return {
    type: "response.completed",
    response: {
      output: calls.map((c) => ({
        type: "function_call",
        id: c.id,
        name: c.name,
        arguments: c.arguments,
      })),
      usage: usage ?? { total_tokens: 50 },
    },
  };
}

// --- Tests ---

describe("Codex Responses API", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- Routing ----

  describe("isCodexOAuth routing", () => {
    it("complete routes to Codex when OAuth configured (no apiKey)", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("hello")]), { status: 200 }),
      );

      await client.complete({ prompt: "hi" });

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe(CODEX_URL);
    });

    it("complete routes to OpenAI SDK when apiKey present", async () => {
      const client = makeClient({ apiKey: "sk-test" });
      // OpenAI SDK will throw because it's mocked away, but we verify codex URL is NOT hit
      await expect(client.complete({ prompt: "hi" })).rejects.toThrow();
      // fetchSpy should not have been called with the codex URL
      for (const call of fetchSpy.mock.calls) {
        expect(call[0]).not.toBe(CODEX_URL);
      }
    });

    it("chat routes to Codex when OAuth configured (no apiKey)", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("hi")]), { status: 200 }),
      );

      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0][0]).toBe(CODEX_URL);
    });
  });

  // ---- codexComplete (via complete) ----

  describe("codexComplete", () => {
    it("returns text from output_text", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("Hello world")]), { status: 200 }),
      );

      const res = await client.complete({ prompt: "say hello" });
      expect(res.text).toBe("Hello world");
    });

    it("returns tokensUsed from usage", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("x", { total_tokens: 99 })]), { status: 200 }),
      );

      const res = await client.complete({ prompt: "x" });
      expect(res.tokensUsed).toBe(99);
    });

    it("passes system as instructions in request body", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("ok")]), { status: 200 }),
      );

      await client.complete({ prompt: "do it", system: "You are helpful" });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.instructions).toBe("You are helpful");
    });
  });

  // ---- codexChat message format (via chat) ----

  describe("codexChat", () => {
    function chatFetch(events: any[]) {
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse(events), { status: 200 }),
      );
    }

    it("converts user messages to Codex input format", async () => {
      const client = makeClient();
      chatFetch([completedEvent("ok")]);

      await client.chat({ messages: [{ role: "user", content: "hello" }] });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.input).toContainEqual({ type: "message", role: "user", content: "hello" });
    });

    it("extracts system message to instructions field", async () => {
      const client = makeClient();
      chatFetch([completedEvent("ok")]);

      await client.chat({
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "hi" },
        ],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.instructions).toBe("Be concise");
      // system message should not appear in input[]
      expect(body.input.every((i: any) => i.role !== "system")).toBe(true);
    });

    it("converts assistant with tool_calls to separate function_call items", async () => {
      const client = makeClient();
      chatFetch([completedEvent("done")]);

      await client.chat({
        messages: [
          { role: "user", content: "check weather" },
          {
            role: "assistant",
            content: "Let me check",
            tool_calls: [
              { id: "fc_abc", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
            ],
          },
          { role: "tool", content: "72F sunny", tool_call_id: "fc_abc" },
        ],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      // assistant text message
      expect(body.input).toContainEqual({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Let me check" }],
      });
      // function_call as separate top-level item
      expect(body.input).toContainEqual({
        type: "function_call",
        id: "fc_abc",
        call_id: "fc_abc",
        name: "get_weather",
        arguments: '{"city":"NYC"}',
      });
    });

    it("converts tool results to function_call_output items", async () => {
      const client = makeClient();
      chatFetch([completedEvent("done")]);

      await client.chat({
        messages: [
          { role: "user", content: "x" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "fc_1", function: { name: "fn", arguments: "{}" } }],
          },
          { role: "tool", content: "result data", tool_call_id: "fc_1" },
        ],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.input).toContainEqual({
        type: "function_call_output",
        call_id: "fc_1",
        output: "result data",
      });
    });

    it("parses text response correctly", async () => {
      const client = makeClient();
      chatFetch([completedEvent("The answer is 42")]);

      const res = await client.chat({ messages: [{ role: "user", content: "?" }] });
      expect(res.message.role).toBe("assistant");
      expect(res.message.content).toBe("The answer is 42");
      expect(res.message.tool_calls).toBeUndefined();
    });

    it("parses function_call response into tool_calls with fc_ IDs", async () => {
      const client = makeClient();
      chatFetch([
        completedWithToolCalls([
          { id: "fc_xyz", name: "search", arguments: '{"q":"test"}' },
        ]),
      ]);

      const res = await client.chat({
        messages: [{ role: "user", content: "search" }],
        tools: [{ name: "search", description: "search", parameters: {} }],
      });

      expect(res.message.tool_calls).toHaveLength(1);
      expect(res.message.tool_calls![0]).toEqual({
        id: "fc_xyz",
        function: { name: "search", arguments: '{"q":"test"}' },
      });
    });

    it("sets tool_choice to auto in request body", async () => {
      const client = makeClient();
      chatFetch([completedEvent("ok")]);

      await client.chat({
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "t", description: "d", parameters: {} }],
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.tool_choice).toBe("auto");
    });
  });

  // ---- Error handling ----

  describe("error handling", () => {
    it("throws on non-200 response with status code", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response("rate limited", { status: 429 }),
      );

      await expect(client.complete({ prompt: "x" })).rejects.toThrow("Codex API error (429)");
    });

    it("throws when no response.completed event in stream", async () => {
      const client = makeClient();
      // SSE with only intermediate events, no completed/done
      const sse = makeSseResponse([
        { type: "response.output_item.added", item: { type: "message" } },
      ]).replace("data: [DONE]\n\n", ""); // remove [DONE] but keep valid SSE
      fetchSpy.mockResolvedValueOnce(new Response(sse, { status: 200 }));

      await expect(client.complete({ prompt: "x" })).rejects.toThrow(
        "No response.completed event",
      );
    });

    it("throws on invalid JWT token (not 3 parts)", async () => {
      const client = new LlmClient();
      client.configure({
        provider: "openai",
        model: "gpt-5.1-codex",
        openaiOAuth: {
          accessToken: "not-a-jwt",
          refreshToken: "rt_xxx",
          expiresAt: Date.now() + 3600_000,
        },
      });
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));

      await expect(client.complete({ prompt: "x" })).rejects.toThrow("Invalid JWT token");
    });
  });

  // ---- SSE parsing ----

  describe("SSE parsing", () => {
    it("handles response.done event type", async () => {
      const client = makeClient();
      const doneEvent = {
        type: "response.done",
        response: {
          output: [{ type: "message", content: [{ type: "output_text", text: "via done" }] }],
          usage: { total_tokens: 10 },
        },
      };
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([doneEvent]), { status: 200 }),
      );

      const res = await client.complete({ prompt: "x" });
      expect(res.text).toBe("via done");
    });

    it("ignores intermediate events and uses response.completed", async () => {
      const client = makeClient();
      const events = [
        { type: "response.output_item.added", item: { type: "message" } },
        { type: "response.content_part.added", part: { type: "output_text", text: "" } },
        { type: "response.output_text.delta", delta: "partial" },
        completedEvent("final answer"),
      ];
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse(events), { status: 200 }),
      );

      const res = await client.complete({ prompt: "x" });
      expect(res.text).toBe("final answer");
    });
  });

  // ---- Request headers ----

  describe("request headers", () => {
    it("sends correct headers including chatgpt-account-id", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("ok")]), { status: 200 }),
      );

      await client.complete({ prompt: "hi" });

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers["chatgpt-account-id"]).toBe(ACCOUNT_ID);
      expect(headers["OpenAI-Beta"]).toBe("responses=experimental");
      expect(headers["Authorization"]).toMatch(/^Bearer /);
    });

    it("sets stream:true and store:false in request body", async () => {
      const client = makeClient();
      fetchSpy.mockResolvedValueOnce(
        new Response(makeSseResponse([completedEvent("ok")]), { status: 200 }),
      );

      await client.complete({ prompt: "hi" });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.store).toBe(false);
    });
  });
});
