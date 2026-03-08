import type { CommandExecutor } from "./types.js";
import { LocalExec } from "./local.js";
import { SshExec } from "./ssh.js";
import type { HostStore } from "../hosts/store.js";

const localExec = new LocalExec();

/**
 * Get the right executor for an instance.
 * - `local-*` → LocalExec
 * - `ssh-{hostId}-*` → SshExec with HostStore credentials
 */
export function getExecutor(instanceId: string, hostStore: HostStore): CommandExecutor {
  if (instanceId.startsWith("local-")) {
    return localExec;
  }

  const match = instanceId.match(/^ssh-(\d+)-/);
  if (!match) throw new Error(`Unknown instance type: ${instanceId}`);

  const hostId = parseInt(match[1]);
  const host = hostStore.list().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host not found: ${hostId}`);

  const cred = hostStore.getDecryptedCredential(hostId);
  if (!cred) throw new Error(`No credential for host: ${hostId}`);

  return new SshExec({
    host: host.host,
    port: host.port,
    username: host.username,
    password: host.authMethod === "password" ? cred : undefined,
    privateKey: host.authMethod === "privateKey" ? cred : undefined,
  });
}

/**
 * Get executor for a host (for install/upgrade operations that target a host, not an instance).
 */
export function getHostExecutor(hostId: number | "local", hostStore: HostStore): CommandExecutor {
  if (hostId === "local") return localExec;

  const host = hostStore.list().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host not found: ${hostId}`);

  const cred = hostStore.getDecryptedCredential(hostId);
  if (!cred) throw new Error(`No credential for host: ${hostId}`);

  return new SshExec({
    host: host.host,
    port: host.port,
    username: host.username,
    password: host.authMethod === "password" ? cred : undefined,
    privateKey: host.authMethod === "privateKey" ? cred : undefined,
  });
}
