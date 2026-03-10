/**
 * Fetch Codex (OpenAI OAuth) usage quota from chatgpt.com/backend-api/wham/usage.
 * Same API that OpenClaw uses internally — see provider-usage.fetch.codex.ts
 */

export interface QuotaWindow {
  label: string;        // "3h", "Day", "Week"
  usedPercent: number;  // 0-100
  resetAt: number;      // epoch ms
  windowSeconds: number;
}

export interface CodexQuota {
  windows: QuotaWindow[];
  plan?: string;
  credits?: number;
  error?: string;
}

/**
 * Determine the label for the secondary window.
 * OpenClaw has quirk handling: sometimes Codex reports 24h but reset timestamps reveal weekly cadence.
 */
function windowLabel(seconds: number, primaryResetAt?: number, secondaryResetAt?: number): string {
  if (seconds >= 604_800) return "Week";
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  // Quirk: if secondary reset is ≥3 days after primary, it's actually weekly
  if (primaryResetAt && secondaryResetAt && secondaryResetAt - primaryResetAt >= 3 * 86_400) {
    return "Week";
  }
  return "Day";
}

/**
 * Fetch Codex quota. Runs via SSH on the remote host to avoid Cloudflare blocking.
 * @param exec - SSH executor for the host where the instance runs
 * @param accessToken - OAuth access token from auth-profiles.json
 * @param accountId - ChatGPT account ID (optional)
 */
export async function fetchCodexQuotaViaSSH(
  exec: { exec: (cmd: string, opts?: any) => Promise<{ stdout: string; stderr: string; exitCode: number }> },
  accessToken: string,
  accountId?: string,
): Promise<CodexQuota> {
  const headers = [
    `-H 'Authorization: Bearer ${accessToken}'`,
    `-H 'User-Agent: CodexBar'`,
    `-H 'Accept: application/json'`,
  ];
  if (accountId) {
    headers.push(`-H 'ChatGPT-Account-Id: ${accountId}'`);
  }

  const cmd = `curl -sS --max-time 10 ${headers.join(" ")} 'https://chatgpt.com/backend-api/wham/usage' 2>&1`;
  const r = await exec.exec(cmd, { timeout: 15_000 });

  if (r.exitCode !== 0) {
    return { windows: [], error: `curl failed: ${r.stderr.slice(0, 200)}` };
  }

  let data: any;
  try {
    data = JSON.parse(r.stdout.trim());
  } catch {
    return { windows: [], error: `Invalid JSON: ${r.stdout.slice(0, 200)}` };
  }

  const windows: QuotaWindow[] = [];
  const rl = data.rate_limit;
  if (rl) {
    const pw = rl.primary_window;
    const sw = rl.secondary_window;

    if (pw) {
      const secs = pw.limit_window_seconds || 10_800;
      windows.push({
        label: `${Math.round(secs / 3600)}h`,
        usedPercent: Math.min(100, Math.max(0, pw.used_percent || 0)),
        resetAt: (pw.reset_at || 0) * 1000,
        windowSeconds: secs,
      });
    }
    if (sw) {
      const secs = sw.limit_window_seconds || 86_400;
      windows.push({
        label: windowLabel(secs, pw?.reset_at, sw?.reset_at),
        usedPercent: Math.min(100, Math.max(0, sw.used_percent || 0)),
        resetAt: (sw.reset_at || 0) * 1000,
        windowSeconds: secs,
      });
    }
  }

  let credits: number | undefined;
  if (data.credits?.balance != null) {
    const bal = parseFloat(String(data.credits.balance));
    if (!isNaN(bal)) credits = bal;
  }

  return {
    windows,
    plan: data.plan_type || undefined,
    credits,
  };
}
