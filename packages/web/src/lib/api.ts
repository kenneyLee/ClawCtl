const BASE = "/api";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // Session expired — reload to show login
    window.location.reload();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `API error: ${res.status}`);
  }
  return res.json();
}

export const get = <T = unknown>(path: string) => api<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const put = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });
