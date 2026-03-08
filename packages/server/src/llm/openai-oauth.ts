import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";

export interface OpenAIOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

interface PendingFlow {
  status: "waiting_auth" | "authenticating" | "complete" | "error";
  authUrl: string;
  verifier: string;
  state: string;
  server: Server;
  credentials?: OpenAIOAuthCredentials;
  error?: string;
  resolveManualCode?: (code: string) => void;
}

let pendingFlow: PendingFlow | null = null;

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function startCallbackServer(state: string): Promise<{ server: Server; waitForCode: () => Promise<string | null> }> {
  let resolveCode: (code: string | null) => void;
  const codePromise = new Promise<string | null>((resolve) => { resolveCode = resolve; });
  let resolved = false;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.end("State mismatch");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Missing authorization code");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><body><p>Authentication successful. You can close this tab and return to ClawCtl.</p></body></html>`);
      if (!resolved) {
        resolved = true;
        resolveCode(code);
      }
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(1455, "127.0.0.1", () => {
      resolve({
        server,
        waitForCode: () => {
          // Timeout after 120s
          const timeout = setTimeout(() => {
            if (!resolved) { resolved = true; resolveCode(null); }
          }, 120_000);
          return codePromise.then((code) => { clearTimeout(timeout); return code; });
        },
      });
    });
    server.on("error", (err) => {
      reject(new Error(`Cannot bind port 1455: ${(err as NodeJS.ErrnoException).code}`));
    });
  });
}

async function exchangeCode(code: string, verifier: string): Promise<OpenAIOAuthCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const json = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("Token response missing required fields");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

export async function refreshOpenAIToken(refreshToken: string): Promise<OpenAIOAuthCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  const json = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("Refresh response missing required fields");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Start the OpenAI OAuth flow. Returns the auth URL for the user to visit. */
export async function startOpenAIOAuth(): Promise<{ authUrl: string }> {
  // Clean up any previous flow
  if (pendingFlow) {
    try { pendingFlow.server.close(); } catch { /* ignore */ }
    pendingFlow = null;
  }

  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  const authUrl = url.toString();

  const { server, waitForCode } = await startCallbackServer(state);

  pendingFlow = { status: "waiting_auth", authUrl, verifier, state, server };

  // Background: wait for the callback code
  (async () => {
    try {
      // Race between callback server and manual code paste
      let code: string | null = null;
      const manualPromise = new Promise<string>((resolve) => {
        pendingFlow!.resolveManualCode = resolve;
      });

      const result = await Promise.race([
        waitForCode(),
        manualPromise.then((input) => {
          // Parse manual input — could be full redirect URL or just the code
          try {
            const parsed = new URL(input);
            return parsed.searchParams.get("code");
          } catch {
            return input.trim();
          }
        }),
      ]);
      code = result;

      if (!code) {
        throw new Error("OAuth timed out — no authorization code received");
      }

      pendingFlow!.status = "authenticating";
      const credentials = await exchangeCode(code, verifier);
      pendingFlow!.credentials = credentials;
      pendingFlow!.status = "complete";
    } catch (err: any) {
      if (pendingFlow) {
        pendingFlow.status = "error";
        pendingFlow.error = err.message;
      }
    } finally {
      try { server.close(); } catch { /* ignore */ }
    }
  })();

  return { authUrl };
}

/** Get the current OAuth flow status */
export function getOAuthStatus(): {
  status: "none" | "waiting_auth" | "authenticating" | "complete" | "error";
  credentials?: OpenAIOAuthCredentials;
  error?: string;
} {
  if (!pendingFlow) return { status: "none" };
  return {
    status: pendingFlow.status,
    credentials: pendingFlow.credentials,
    error: pendingFlow.error,
  };
}

/** Submit a manually pasted redirect URL (for remote/VPS case) */
export function submitManualCode(input: string): boolean {
  if (pendingFlow?.resolveManualCode) {
    pendingFlow.resolveManualCode(input);
    return true;
  }
  return false;
}

/** Clear the pending flow state */
export function clearOAuthFlow(): void {
  if (pendingFlow) {
    try { pendingFlow.server.close(); } catch { /* ignore */ }
    pendingFlow = null;
  }
}
