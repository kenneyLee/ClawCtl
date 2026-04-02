import type { CommandExecutor } from "../executor/types.js";

export function getConfigDir(profile: string): string {
  return profile === "default" ? "$HOME/.openclaw" : `$HOME/.openclaw-${profile}`;
}

/** Extract profile name from instance ID (e.g. "ssh-1-feishu" → "feishu") */
export function profileFromInstanceId(instanceId: string): string {
  const parts = instanceId.split("-");
  return parts[parts.length - 1];
}

export async function readRemoteConfig(exec: CommandExecutor, configDir: string): Promise<any> {
  const r = await exec.exec(`cat "${configDir}/openclaw.json"`);
  if (r.exitCode !== 0) throw new Error(`Failed to read config: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export async function writeRemoteConfig(exec: CommandExecutor, configDir: string, config: any): Promise<void> {
  const json = JSON.stringify(config, null, 2);
  const r = await exec.exec(`cat > "${configDir}/openclaw.json" << 'CLAWCTL_EOF'\n${json}\nCLAWCTL_EOF`);
  if (r.exitCode !== 0) throw new Error(`Failed to write config: ${r.stderr}`);
}

export async function readSoulMarkdown(
  exec: CommandExecutor,
  configDir: string,
): Promise<{ exists: boolean; path: string; content: string }> {
  const path = `${configDir}/workspace/SOUL.md`;
  const r = await exec.exec(`if [ -f "${path}" ]; then cat "${path}"; else exit 2; fi`);
  if (r.exitCode === 0) return { exists: true, path, content: r.stdout };
  if (r.exitCode === 2) return { exists: false, path, content: "" };
  throw new Error(`Failed to read SOUL.md: ${r.stderr}`);
}

/** Read auth-profiles.json for a specific agent */
export async function readAuthProfiles(exec: CommandExecutor, configDir: string, agentId: string): Promise<any> {
  const path = `${configDir}/agents/${agentId}/agent/auth-profiles.json`;
  const r = await exec.exec(`cat "${path}" 2>/dev/null || echo '{}'`);
  try { return JSON.parse(r.stdout); } catch { return {}; }
}

/** Write auth-profiles.json for a specific agent */
export async function writeAuthProfiles(exec: CommandExecutor, configDir: string, agentId: string, data: any): Promise<void> {
  const path = `${configDir}/agents/${agentId}/agent/auth-profiles.json`;
  const json = JSON.stringify(data, null, 2);
  const r = await exec.exec(`mkdir -p "${configDir}/agents/${agentId}/agent" && cat > "${path}" << 'CLAWCTL_EOF'\n${json}\nCLAWCTL_EOF`);
  if (r.exitCode !== 0) throw new Error(`Failed to write auth-profiles: ${r.stderr}`);
}

/** Remove a single profile from auth-profiles.json and clean up references */
export async function deleteAuthProfile(
  exec: CommandExecutor,
  configDir: string,
  agentId: string,
  profileId: string,
): Promise<void> {
  const data = await readAuthProfiles(exec, configDir, agentId);
  if (!data.profiles) return;

  delete data.profiles[profileId];

  // Clean up order references
  if (data.order) {
    for (const [provider, ids] of Object.entries(data.order) as [string, string[]][]) {
      data.order[provider] = ids.filter((id: string) => id !== profileId);
      if (data.order[provider].length === 0) delete data.order[provider];
    }
  }
  // Clean up lastGood references
  if (data.lastGood) {
    for (const [provider, id] of Object.entries(data.lastGood) as [string, string][]) {
      if (id === profileId) delete data.lastGood[provider];
    }
  }
  // Clean up usageStats references
  if (data.usageStats) {
    delete data.usageStats[profileId];
  }

  await writeAuthProfiles(exec, configDir, agentId, data);
}
