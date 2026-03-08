import type { LlmConfig, LlmRequest, LlmResponse, ChatRequest, ChatResponse, ToolDef, ChatMessage } from "./types.js";
import { refreshOpenAIToken } from "./openai-oauth.js";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export class LlmClient {
  private config: LlmConfig | null = null;
  private azureToken: CachedToken | null = null;

  configure(config: LlmConfig) {
    this.config = config;
    this.azureToken = null; // reset on reconfigure
  }

  getConfig(): LlmConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    if (!this.config) return false;
    if (this.config.provider === "azure") {
      const az = this.config.azure;
      if (!az?.resourceName || !az.deploymentName) return false;
      return az.auth === "ad" ? !!az.clientId : !!this.config.apiKey;
    }
    if (this.config.provider === "openai" && this.config.openaiOAuth?.accessToken) return true;
    if (this.config.provider === "ollama") return true;
    return !!this.config.apiKey;
  }

  /** Fetch Azure AD token via Client Credentials, cache with 60s buffer */
  private async getAzureAdToken(): Promise<string> {
    const az = this.config!.azure;
    if (!az?.tenantId || !az.clientId || !az.clientSecret) {
      throw new Error("Azure AD auth requires tenantId, clientId, clientSecret");
    }

    if (this.azureToken && this.azureToken.expiresAt > Date.now() + 60_000) {
      return this.azureToken.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${az.tenantId}/oauth2/v2.0/token`;
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: az.clientId,
        client_secret: az.clientSecret,
        scope: "https://cognitiveservices.azure.com/.default",
      }).toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure AD token failed (${res.status}): ${text}`);
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    this.azureToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.azureToken.accessToken;
  }

  /** Resolve API key — static for most providers, Azure AD or Azure key for azure, OAuth for openai */
  private async resolveApiKey(): Promise<string> {
    if (this.config!.provider === "azure") {
      const az = this.config!.azure;
      if (az?.auth === "ad") return this.getAzureAdToken();
      return this.config!.apiKey || "";
    }
    if (this.config!.provider === "openai" && this.config!.openaiOAuth?.accessToken) {
      return this.getOpenAIOAuthToken();
    }
    return this.config!.apiKey || "";
  }

  /** Get OpenAI OAuth token, auto-refresh if expired (60s buffer) */
  private async getOpenAIOAuthToken(): Promise<string> {
    const oauth = this.config!.openaiOAuth!;
    if (oauth.expiresAt > Date.now() + 60_000) {
      return oauth.accessToken;
    }
    try {
      const refreshed = await refreshOpenAIToken(oauth.refreshToken);
      oauth.accessToken = refreshed.accessToken;
      oauth.refreshToken = refreshed.refreshToken;
      oauth.expiresAt = refreshed.expiresAt;
      // Notify caller to persist updated tokens
      this.onOAuthRefresh?.(oauth);
      return oauth.accessToken;
    } catch (err: any) {
      // Fall back to existing token if refresh fails
      console.warn("OpenAI OAuth token refresh failed:", err.message);
      return oauth.accessToken;
    }
  }

  /** Callback invoked when OAuth tokens are refreshed — set by the app to persist updated tokens */
  onOAuthRefresh?: (oauth: { accessToken: string; refreshToken: string; expiresAt: number }) => void;

  /** Check if using ChatGPT OAuth (Codex Responses API) */
  private isCodexOAuth(): boolean {
    return this.config!.provider === "openai" && !!this.config!.openaiOAuth?.accessToken && !this.config!.apiKey;
  }

  /** Build base URL — Azure auto-constructs from resource/deployment names */
  private resolveBaseUrl(): string | undefined {
    if (this.config!.provider === "azure" && this.config!.azure) {
      const az = this.config!.azure;
      const version = az.apiVersion || "2024-10-21";
      return `https://${az.resourceName}.openai.azure.com/openai/deployments/${az.deploymentName}?api-version=${version}`;
    }
    return this.config!.baseUrl;
  }

  /** Extract chatgpt_account_id from OAuth JWT token */
  private extractAccountId(token: string): string {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT token");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (!accountId) throw new Error("No account ID in token");
    return accountId;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.config) {
      throw new Error("LLM not configured. Set API key in Settings.");
    }

    switch (this.config.provider) {
      case "openai":
      case "azure":
        if (this.isCodexOAuth()) return this.codexComplete(req);
        return this.openaiComplete(req);
      case "anthropic":
        return this.anthropicComplete(req);
      case "ollama":
        return this.ollamaComplete(req);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.config) {
      throw new Error("LLM not configured. Set API key in Settings.");
    }

    switch (this.config.provider) {
      case "openai":
      case "azure":
        if (this.isCodexOAuth()) return this.codexChat(req);
        return this.openaiChat(req);
      case "anthropic":
        return this.anthropicChat(req);
      default:
        throw new Error(`Chat with tools not supported for provider: ${this.config.provider}`);
    }
  }

  private async openaiChat(req: ChatRequest): Promise<ChatResponse> {
    const { default: OpenAI } = await import("openai");
    const apiKey = await this.resolveApiKey();
    const client = new OpenAI({ apiKey, baseURL: this.resolveBaseUrl() });
    const tools = req.tools?.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const messages = req.messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, content: m.content, tool_call_id: m.tool_call_id! };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
      }
      return { role: m.role as "system" | "user" | "assistant", content: m.content };
    });
    const r = await client.chat.completions.create({
      model: this.config!.model,
      messages,
      tools: tools?.length ? tools : undefined,
      max_tokens: req.maxTokens || 2000,
    });
    const choice = r.choices[0];
    const msg: ChatMessage = {
      role: "assistant",
      content: choice.message.content || "",
    };
    if (choice.message.tool_calls?.length) {
      msg.tool_calls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    return { message: msg, tokensUsed: r.usage?.total_tokens };
  }

  private async anthropicChat(req: ChatRequest): Promise<ChatResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const apiKey = await this.resolveApiKey();
    const client = new Anthropic({ apiKey });
    const systemMsg = req.messages.find((m) => m.role === "system")?.content || "";
    const nonSystemMsgs = req.messages.filter((m) => m.role !== "system");
    const messages = nonSystemMsgs.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [{ type: "tool_result" as const, tool_use_id: m.tool_call_id!, content: m.content }],
        };
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
        }
        return { role: "assistant" as const, content };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });
    const tools = req.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as any,
    }));
    const r = await client.messages.create({
      model: this.config!.model,
      max_tokens: req.maxTokens || 2000,
      system: systemMsg,
      messages,
      tools: tools?.length ? tools : undefined,
    });
    const msg: ChatMessage = { role: "assistant", content: "" };
    const toolCalls: ChatMessage["tool_calls"] = [];
    for (const block of r.content) {
      if (block.type === "text") msg.content += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, function: { name: block.name, arguments: JSON.stringify(block.input) } });
      }
    }
    if (toolCalls.length) msg.tool_calls = toolCalls;
    return { message: msg, tokensUsed: r.usage.input_tokens + r.usage.output_tokens };
  }

  private async openaiComplete(req: LlmRequest): Promise<LlmResponse> {
    const { default: OpenAI } = await import("openai");
    const apiKey = await this.resolveApiKey();
    const client = new OpenAI({
      apiKey,
      baseURL: this.resolveBaseUrl(),
    });
    const r = await client.chat.completions.create({
      model: this.config!.model,
      messages: [
        ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
        { role: "user" as const, content: req.prompt },
      ],
      max_tokens: req.maxTokens || 1000,
    });
    return {
      text: r.choices[0]?.message?.content || "",
      tokensUsed: r.usage?.total_tokens,
    };
  }

  private async anthropicComplete(req: LlmRequest): Promise<LlmResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const apiKey = await this.resolveApiKey();
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
      model: this.config!.model,
      max_tokens: req.maxTokens || 1000,
      system: req.system || "",
      messages: [{ role: "user", content: req.prompt }],
    });
    const text = r.content[0]?.type === "text" ? r.content[0].text : "";
    return {
      text,
      tokensUsed: r.usage.input_tokens + r.usage.output_tokens,
    };
  }

  /** Send request to Codex Responses API (streaming required), collect full response */
  private async codexRequest(body: any): Promise<any> {
    const token = await this.getOpenAIOAuthToken();
    const accountId = this.extractAccountId(token);
    body.stream = true;
    body.store = false;
    const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "chatgpt-account-id": accountId,
        "OpenAI-Beta": "responses=experimental",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Codex API error (${res.status}): ${errText}`);
    }
    // Parse SSE stream and collect the final response.completed event
    const text = await res.text();
    let finalResponse: any = null;
    for (const chunk of text.split("\n\n")) {
      const dataLines = chunk.split("\n").filter((l: string) => l.startsWith("data:")).map((l: string) => l.slice(5).trim());
      if (!dataLines.length) continue;
      const data = dataLines.join("\n").trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        if (event.type === "response.completed" || event.type === "response.done") {
          finalResponse = event.response;
        }
      } catch { /* skip unparseable */ }
    }
    if (!finalResponse) throw new Error("No response.completed event in Codex stream");
    return finalResponse;
  }

  /** Call ChatGPT Codex Responses API for simple completions */
  private async codexComplete(req: LlmRequest): Promise<LlmResponse> {
    const json = await this.codexRequest({
      model: this.config!.model,
      instructions: req.system || "",
      input: [{ type: "message", role: "user", content: req.prompt }],
    });
    let text = "";
    for (const item of json.output || []) {
      if (item.type === "message") {
        for (const c of item.content || []) {
          if (c.type === "output_text") text += c.text;
        }
      }
    }
    return { text, tokensUsed: json.usage?.total_tokens };
  }

  /** Call ChatGPT Codex Responses API for chat with tool calling */
  private async codexChat(req: ChatRequest): Promise<ChatResponse> {
    const systemMsg = req.messages.find((m) => m.role === "system")?.content || "";
    const input: any[] = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        input.push({ type: "message", role: "user", content: m.content });
      } else if (m.role === "assistant") {
        // Assistant text goes as a message item
        if (m.content) {
          input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: m.content }] });
        }
        // Tool calls are separate top-level input items (not inside message content)
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            input.push({
              type: "function_call",
              id: tc.id,  // fc_ format ID
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }
      } else if (m.role === "tool") {
        input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
      }
    }
    const tools = req.tools?.map((t) => ({
      type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false,
    }));
    const body: any = {
      model: this.config!.model,
      instructions: systemMsg,
      input,
      tool_choice: "auto",
    };
    if (tools?.length) body.tools = tools;
    const json = await this.codexRequest(body);
    const msg: ChatMessage = { role: "assistant", content: "" };
    const toolCalls: ChatMessage["tool_calls"] = [];
    for (const item of json.output || []) {
      if (item.type === "message") {
        for (const c of item.content || []) {
          if (c.type === "output_text") msg.content += c.text;
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.id,
          function: { name: item.name, arguments: item.arguments },
        });
      }
    }
    if (toolCalls.length) msg.tool_calls = toolCalls;
    return { message: msg, tokensUsed: json.usage?.total_tokens };
  }

  private async ollamaComplete(req: LlmRequest): Promise<LlmResponse> {
    const baseUrl = this.config!.baseUrl || "http://localhost:11434";
    const r = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config!.model,
        system: req.system,
        prompt: req.prompt,
        stream: false,
      }),
    });
    const json = await r.json();
    return { text: json.response || "" };
  }
}
