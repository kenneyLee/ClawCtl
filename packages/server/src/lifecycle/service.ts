import type { CommandExecutor } from "../executor/types.js";

export interface ProcessStatus {
  running: boolean;
  pid?: number;
}

export async function getProcessStatus(exec: CommandExecutor, port: number): Promise<ProcessStatus> {
  const r = await exec.exec(`lsof -ti :${port} 2>/dev/null | head -1`);
  const pid = parseInt(r.stdout.trim());
  if (pid > 0) return { running: true, pid };
  return { running: false };
}

/** Derive the systemd unit name from profile. e.g. "default" → "openclaw-gateway", "feishu" → "openclaw-gateway-feishu" */
function unitName(profile: string): string {
  return profile === "default" ? "openclaw-gateway" : `openclaw-gateway-${profile}`;
}

/** Check if a systemd user unit exists and is loaded for this profile. */
async function hasSystemdUnit(exec: CommandExecutor, profile: string): Promise<boolean> {
  const r = await exec.exec(`systemctl --user is-enabled ${unitName(profile)}.service 2>/dev/null`);
  const out = r.stdout.trim();
  return out === "enabled" || out === "static" || out === "linked";
}

export async function stopProcess(exec: CommandExecutor, pid: number, force = false): Promise<void> {
  const signal = force ? "SIGKILL" : "SIGTERM";
  await exec.exec(`kill -s ${signal} ${pid} 2>/dev/null; true`);
}

export async function startProcess(exec: CommandExecutor, configDir: string, port: number): Promise<void> {
  await exec.exec(
    `OPENCLAW_HOME="${configDir}" nohup openclaw --port ${port} > "${configDir}/gateway.log" 2>&1 &`
  );
}

export async function restartProcess(exec: CommandExecutor, configDir: string, port: number, profile?: string): Promise<void> {
  // Prefer systemd if the profile has a user unit
  if (profile) {
    const useSystemd = await hasSystemdUnit(exec, profile);
    if (useSystemd) {
      await exec.exec(`systemctl --user restart ${unitName(profile)}.service`);
      return;
    }
  }
  // Fallback: kill + nohup
  const status = await getProcessStatus(exec, port);
  if (status.running && status.pid) {
    await stopProcess(exec, status.pid);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = await getProcessStatus(exec, port);
      if (!s.running) break;
    }
  }
  await startProcess(exec, configDir, port);
}
