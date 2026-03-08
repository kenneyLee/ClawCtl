export interface LlmConfig {
  provider: "openai" | "anthropic" | "ollama" | "azure";
  apiKey?: string;
  /** Custom base URL (OpenAI-compatible endpoints, Ollama, etc.) */
  baseUrl?: string;
  model: string;
  /** Azure OpenAI specific config */
  azure?: {
    resourceName: string;
    deploymentName: string;
    apiVersion?: string; // defaults to "2024-10-21"
    /** "key" = use apiKey field; "ad" = Azure AD Client Credentials */
    auth: "key" | "ad";
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
  };
  /** OpenAI OAuth (ChatGPT subscription) credentials */
  openaiOAuth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // epoch ms
  };
}

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  tokensUsed?: number;
}

// --- Chat with tool calling ---

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  tokensUsed?: number;
}
