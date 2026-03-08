# V0.2 Instance Lifecycle Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add instance lifecycle management (install/start/stop/upgrade/config edit/logs) for both local and remote OpenClaw instances, unified through a CommandExecutor abstraction.

**Architecture:** A `CommandExecutor` interface with two implementations — `LocalExec` (child_process) and `SshExec` (ssh2, reusing existing HostStore credentials). Lifecycle operations are pure functions that accept an executor. API routes in `api/lifecycle.ts` determine the correct executor from instance ID prefix (`local-*` vs `ssh-*`). Frontend adds a "Control" tab to the Instance detail page.

**Tech Stack:** TypeScript, ssh2 (already installed), Hono (existing), SSE for log streaming, React (existing frontend)

---

## Task 1: CommandExecutor Interface + LocalExec

**Files:**
- Create: `packages/server/src/executor/types.ts`
- Create: `packages/server/src/executor/local.ts`
- Test: `packages/server/src/executor/__tests__/local.test.ts`

**Step 1: Write types**

```typescript
// packages/server/src/executor/types.ts
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface CommandExecutor {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Streaming exec — yields chunks of combined stdout+stderr */
  execStream(command: string, opts?: ExecOptions): AsyncIterable<string>;
}
```

**Step 2: Write failing tests for LocalExec**

```typescript
// packages/server/src/executor/__tests__/local.test.ts
import { describe, it, expect } from "vitest";
import { LocalExec } from "../local.js";

describe("LocalExec", () => {
  const exec = new LocalExec();

  it("runs a simple command", async () => {
    const r = await exec.exec("echo hello");
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
  });

  it("captures stderr", async () => {
    const r = await exec.exec("echo err >&2");
    expect(r.stderr.trim()).toBe("err");
    expect(r.exitCode).toBe(0);
  });

  it("returns non-zero exit code without throwing", async () => {
    const r = await exec.exec("exit 42");
    expect(r.exitCode).toBe(42);
  });

  it("respects timeout", async () => {
    const r = await exec.exec("sleep 10", { timeout: 500 });
    expect(r.exitCode).not.toBe(0);
  });

  it("streams output", async () => {
    const chunks: string[] = [];
    for await (const chunk of exec.execStream("echo line1; echo line2")) {
      chunks.push(chunk);
    }
    const combined = chunks.join("");
    expect(combined).toContain("line1");
    expect(combined).toContain("line2");
  });
});
```

**Step 3: Implement LocalExec**

```typescript
// packages/server/src/executor/local.ts
import { exec as cpExec, spawn } from "child_process";
import type { CommandExecutor, ExecResult, ExecOptions } from "./types.js";

export class LocalExec implements CommandExecutor {
  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      cpExec(command, {
        timeout: opts?.timeout || 60_000,
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        shell: "/bin/bash",
      }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: err?.code ?? (err ? 1 : 0),
        });
      });
    });
  }

  async *execStream(command: string, opts?: ExecOptions): AsyncIterable<string> {
    const child = spawn("bash", ["-c", command], {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    });

    const timeout = opts?.timeout || 300_000;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);

    try {
      for await (const chunk of child.stdout) {
        yield chunk.toString();
      }
      for await (const chunk of child.stderr) {
        yield chunk.toString();
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
```

**Step 4: Run tests**

Run: `cd packages/server && npx vitest run src/executor/__tests__/local.test.ts`
Expected: 5 tests pass

**Step 5: Commit**

```
feat: add CommandExecutor interface and LocalExec implementation
```

---

## Task 2: SshExec

**Files:**
- Create: `packages/server/src/executor/ssh.ts`
- Create: `packages/server/src/executor/factory.ts`
- Test: `packages/server/src/executor/__tests__/ssh.test.ts`

**Step 1: Write SshExec (refactor existing sshExec into class)**

```typescript
// packages/server/src/executor/ssh.ts
import { Client } from "ssh2";
import type { CommandExecutor, ExecResult, ExecOptions } from "./types.js";

interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class SshExec implements CommandExecutor {
  constructor(private config: SshConfig) {}

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const conn = await this.connect(opts?.timeout);
    try {
      return await this.run(conn, command, opts?.timeout || 60_000);
    } finally {
      conn.end();
    }
  }

  async *execStream(command: string, opts?: ExecOptions): AsyncIterable<string> {
    const conn = await this.connect(opts?.timeout);
    try {
      yield* this.runStream(conn, command, opts?.timeout || 300_000);
    } finally {
      conn.end();
    }
  }

  private connect(timeout?: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH timeout: ${this.config.host}`));
      }, timeout || 15_000);

      conn.on("ready", () => { clearTimeout(timer); resolve(conn); });
      conn.on("error", (err) => { clearTimeout(timer); reject(err); });

      conn.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        readyTimeout: 10_000,
      });
    });
  }

  private run(conn: Client, command: string, timeout: number): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { conn.end(); reject(new Error("Command timeout")); }, timeout);
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = "";
        let stderr = "";
        stream.on("data", (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });
      });
    });
  }

  private async *runStream(conn: Client, command: string, timeout: number): AsyncIterable<string> {
    const stream = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { conn.end(); reject(new Error("Stream timeout")); }, timeout);
      conn.exec(command, (err, s) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(s);
      });
    });

    for await (const chunk of stream) {
      yield chunk.toString();
    }
  }
}
```

**Step 2: Write factory — resolves executor from instance ID + HostStore**

```typescript
// packages/server/src/executor/factory.ts
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
```

**Step 3: Write unit test for factory**

```typescript
// packages/server/src/executor/__tests__/ssh.test.ts
import { describe, it, expect } from "vitest";
import { LocalExec } from "../local.js";
import { SshExec } from "../ssh.js";

describe("SshExec", () => {
  it("constructs without error", () => {
    const exec = new SshExec({ host: "example.com", port: 22, username: "test", password: "pass" });
    expect(exec).toBeDefined();
  });

  // NOTE: actual SSH tests require a live server — tested manually or in integration
});

describe("executor module exports", () => {
  it("exports LocalExec and SshExec", () => {
    expect(LocalExec).toBeDefined();
    expect(SshExec).toBeDefined();
  });
});
```

**Step 4: Run tests**

Run: `cd packages/server && npx vitest run src/executor/`
Expected: all tests pass

**Step 5: Commit**

```
feat: add SshExec and executor factory
```

---

## Task 3: Lifecycle Service — Service Control (F.2)

**Files:**
- Create: `packages/server/src/lifecycle/service.ts`
- Test: `packages/server/src/lifecycle/__tests__/service.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/server/src/lifecycle/__tests__/service.test.ts
import { describe, it, expect, vi } from "vitest";
import { getProcessStatus, stopProcess, startProcess } from "../service.js";
import type { CommandExecutor, ExecResult } from "../../executor/types.js";

function mockExec(results: Record<string, ExecResult>): CommandExecutor {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(results)) {
        if (cmd.includes(pattern)) return result;
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
    async *execStream() { yield ""; },
  };
}

describe("getProcessStatus", () => {
  it("returns running when port is in use", async () => {
    const exec = mockExec({ "lsof": { stdout: "12345\n", stderr: "", exitCode: 0 } });
    const status = await getProcessStatus(exec, 18789);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(12345);
  });

  it("returns stopped when port is free", async () => {
    const exec = mockExec({ "lsof": { stdout: "", stderr: "", exitCode: 1 } });
    const status = await getProcessStatus(exec, 18789);
    expect(status.running).toBe(false);
  });
});

describe("stopProcess", () => {
  it("sends SIGTERM to pid", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await stopProcess(exec, 12345);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("kill 12345"));
  });
});

describe("startProcess", () => {
  it("launches openclaw with correct config dir and port", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await startProcess(exec, "/home/ubuntu/.openclaw", 18789);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("OPENCLAW_HOME"));
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("18789"));
  });
});
```

**Step 2: Implement service control**

```typescript
// packages/server/src/lifecycle/service.ts
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

export async function stopProcess(exec: CommandExecutor, pid: number, force = false): Promise<void> {
  const signal = force ? "SIGKILL" : "SIGTERM";
  await exec.exec(`kill -s ${signal} ${pid} 2>/dev/null; true`);
}

export async function startProcess(exec: CommandExecutor, configDir: string, port: number): Promise<void> {
  // nohup + disown so process survives SSH disconnect
  await exec.exec(
    `OPENCLAW_HOME="${configDir}" nohup openclaw --port ${port} > "${configDir}/gateway.log" 2>&1 &`
  );
}

export async function restartProcess(exec: CommandExecutor, configDir: string, port: number): Promise<void> {
  const status = await getProcessStatus(exec, port);
  if (status.running && status.pid) {
    await stopProcess(exec, status.pid);
    // Wait for port to free
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = await getProcessStatus(exec, port);
      if (!s.running) break;
    }
  }
  await startProcess(exec, configDir, port);
}
```

**Step 3: Run tests**

Run: `cd packages/server && npx vitest run src/lifecycle/`
Expected: all pass

**Step 4: Commit**

```
feat: add lifecycle service control (start/stop/restart/status)
```

---

## Task 4: Lifecycle Service — Install & Upgrade (F.1)

**Files:**
- Create: `packages/server/src/lifecycle/install.ts`
- Test: `packages/server/src/lifecycle/__tests__/install.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/server/src/lifecycle/__tests__/install.test.ts
import { describe, it, expect, vi } from "vitest";
import { getVersions, installOpenClaw, checkNodeVersion } from "../install.js";
import type { CommandExecutor, ExecResult } from "../../executor/types.js";

function mockExec(results: Record<string, ExecResult>): CommandExecutor {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(results)) {
        if (cmd.includes(pattern)) return result;
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
    async *execStream() { yield ""; },
  };
}

describe("checkNodeVersion", () => {
  it("returns version when node is installed", async () => {
    const exec = mockExec({ "node --version": { stdout: "v22.5.0\n", stderr: "", exitCode: 0 } });
    const v = await checkNodeVersion(exec);
    expect(v).toEqual({ installed: true, version: "22.5.0", sufficient: true });
  });

  it("returns insufficient for old node", async () => {
    const exec = mockExec({ "node --version": { stdout: "v18.0.0\n", stderr: "", exitCode: 0 } });
    const v = await checkNodeVersion(exec);
    expect(v.sufficient).toBe(false);
  });

  it("returns not installed when node missing", async () => {
    const exec = mockExec({});
    const v = await checkNodeVersion(exec);
    expect(v.installed).toBe(false);
  });
});

describe("getVersions", () => {
  it("returns installed and latest versions", async () => {
    const exec = mockExec({
      "openclaw --version": { stdout: "2026.3.3\n", stderr: "", exitCode: 0 },
      "npm view": { stdout: "2026.3.5\n", stderr: "", exitCode: 0 },
    });
    const v = await getVersions(exec);
    expect(v.installed).toBe("2026.3.3");
    expect(v.latest).toBe("2026.3.5");
    expect(v.updateAvailable).toBe(true);
  });
});

describe("installOpenClaw", () => {
  it("runs npm install command", async () => {
    const execFn = vi.fn(async () => ({ stdout: "added 1 package\n", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    const r = await installOpenClaw(exec);
    expect(r.success).toBe(true);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("npm i -g openclaw"), expect.anything());
  });
});
```

**Step 2: Implement install/upgrade**

```typescript
// packages/server/src/lifecycle/install.ts
import type { CommandExecutor } from "../executor/types.js";

const MIN_NODE_MAJOR = 22;

export interface NodeVersionInfo {
  installed: boolean;
  version?: string;
  sufficient: boolean;
}

export async function checkNodeVersion(exec: CommandExecutor): Promise<NodeVersionInfo> {
  const r = await exec.exec("node --version 2>/dev/null");
  if (r.exitCode !== 0 || !r.stdout.trim()) return { installed: false, sufficient: false };
  const version = r.stdout.trim().replace(/^v/, "");
  const major = parseInt(version.split(".")[0]);
  return { installed: true, version, sufficient: major >= MIN_NODE_MAJOR };
}

export interface VersionInfo {
  installed?: string;
  latest?: string;
  updateAvailable: boolean;
}

export async function getVersions(exec: CommandExecutor): Promise<VersionInfo> {
  const [installedR, latestR] = await Promise.all([
    exec.exec("openclaw --version 2>/dev/null"),
    exec.exec("npm view openclaw version 2>/dev/null"),
  ]);
  const installed = installedR.exitCode === 0 ? installedR.stdout.trim() : undefined;
  const latest = latestR.exitCode === 0 ? latestR.stdout.trim() : undefined;
  return {
    installed,
    latest,
    updateAvailable: !!(installed && latest && installed !== latest),
  };
}

export interface InstallResult {
  success: boolean;
  output: string;
}

export async function installOpenClaw(exec: CommandExecutor, version?: string): Promise<InstallResult> {
  const pkg = version ? `openclaw@${version}` : "openclaw@latest";
  const r = await exec.exec(`npm i -g ${pkg}`, { timeout: 120_000 });
  return { success: r.exitCode === 0, output: r.stdout + r.stderr };
}
```

**Step 3: Run tests**

Run: `cd packages/server && npx vitest run src/lifecycle/__tests__/install.test.ts`
Expected: all pass

**Step 4: Commit**

```
feat: add lifecycle install/upgrade (version check, npm install)
```

---

## Task 5: Lifecycle Service — Config Edit (F.3)

**Files:**
- Create: `packages/server/src/lifecycle/config.ts`
- Test: `packages/server/src/lifecycle/__tests__/config.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/server/src/lifecycle/__tests__/config.test.ts
import { describe, it, expect, vi } from "vitest";
import { readRemoteConfig, writeRemoteConfig, getConfigDir } from "../config.js";
import type { CommandExecutor, ExecResult } from "../../executor/types.js";

function mockExec(results: Record<string, ExecResult>): CommandExecutor {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(results)) {
        if (cmd.includes(pattern)) return result;
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
    async *execStream() { yield ""; },
  };
}

describe("getConfigDir", () => {
  it("resolves config dir from instance profile", () => {
    expect(getConfigDir("default")).toBe("~/.openclaw");
    expect(getConfigDir("feishu")).toBe("~/.openclaw-feishu");
    expect(getConfigDir("tg")).toBe("~/.openclaw-tg");
  });
});

describe("readRemoteConfig", () => {
  it("reads and parses JSON config", async () => {
    const json = JSON.stringify({ gateway: { port: 18789 } });
    const exec = mockExec({ "cat": { stdout: json, stderr: "", exitCode: 0 } });
    const config = await readRemoteConfig(exec, "~/.openclaw");
    expect(config.gateway.port).toBe(18789);
  });
});

describe("writeRemoteConfig", () => {
  it("writes JSON to config file", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await writeRemoteConfig(exec, "~/.openclaw", { gateway: { port: 18789 } });
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("openclaw.json"), undefined);
  });
});
```

**Step 2: Implement config read/write**

```typescript
// packages/server/src/lifecycle/config.ts
import type { CommandExecutor } from "../executor/types.js";

export function getConfigDir(profile: string): string {
  return profile === "default" ? "~/.openclaw" : `~/.openclaw-${profile}`;
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
  // Use heredoc to safely write JSON with special chars
  const escaped = json.replace(/'/g, "'\\''");
  const r = await exec.exec(`cat > "${configDir}/openclaw.json" << 'CLAWCTL_EOF'\n${json}\nCLAWCTL_EOF`);
  if (r.exitCode !== 0) throw new Error(`Failed to write config: ${r.stderr}`);
}
```

**Step 3: Run tests**

Run: `cd packages/server && npx vitest run src/lifecycle/__tests__/config.test.ts`
Expected: all pass

**Step 4: Commit**

```
feat: add lifecycle config read/write
```

---

## Task 6: Lifecycle API Routes

**Files:**
- Create: `packages/server/src/api/lifecycle.ts`
- Modify: `packages/server/src/index.ts` — mount lifecycle routes

**Step 1: Implement API routes**

```typescript
// packages/server/src/api/lifecycle.ts
import { Hono } from "hono";
import { stream } from "hono/streaming";
import type Database from "better-sqlite3";
import type { HostStore } from "../hosts/store.js";
import type { InstanceManager } from "../instances/manager.js";
import { getExecutor, getHostExecutor } from "../executor/factory.js";
import { getProcessStatus, stopProcess, startProcess, restartProcess } from "../lifecycle/service.js";
import { checkNodeVersion, getVersions, installOpenClaw } from "../lifecycle/install.js";
import { readRemoteConfig, writeRemoteConfig, getConfigDir, profileFromInstanceId } from "../lifecycle/config.js";

export function lifecycleRoutes(hostStore: HostStore, manager: InstanceManager, db: Database.Database) {
  const app = new Hono();

  // --- Service control ---

  app.get("/:id/status", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const exec = getExecutor(id, hostStore);
    const status = await getProcessStatus(exec, port);
    return c.json(status);
  });

  app.post("/:id/stop", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const exec = getExecutor(id, hostStore);
    const status = await getProcessStatus(exec, port);
    if (!status.running || !status.pid) return c.json({ error: "not running" }, 400);
    await stopProcess(exec, status.pid);
    logOperation(db, id, "stop", "success", `Stopped PID ${status.pid}`);
    return c.json({ ok: true });
  });

  app.post("/:id/start", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    await startProcess(exec, configDir, port);
    logOperation(db, id, "start", "success", `Started on port ${port}`);
    return c.json({ ok: true });
  });

  app.post("/:id/restart", async (c) => {
    const id = c.req.param("id");
    const inst = manager.get(id);
    if (!inst) return c.json({ error: "instance not found" }, 404);
    const port = parsePortFromInstance(inst);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    await restartProcess(exec, configDir, port);
    logOperation(db, id, "restart", "success", `Restarted on port ${port}`);
    return c.json({ ok: true });
  });

  // --- Config ---

  app.get("/:id/config-file", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const config = await readRemoteConfig(exec, configDir);
    return c.json(config);
  });

  app.put("/:id/config-file", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const body = await c.req.json();
    await writeRemoteConfig(exec, configDir, body);
    logOperation(db, id, "config-write", "success", "Config updated");
    return c.json({ ok: true });
  });

  // --- Install/Upgrade (host-level) ---

  app.get("/host/:hostId/versions", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const exec = getHostExecutor(hostId, hostStore);
    const [node, versions] = await Promise.all([checkNodeVersion(exec), getVersions(exec)]);
    return c.json({ node, openclaw: versions });
  });

  app.post("/host/:hostId/install", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const { version } = await c.req.json().catch(() => ({ version: undefined }));
    const exec = getHostExecutor(hostId, hostStore);
    const result = await installOpenClaw(exec, version);
    logOperation(db, String(hostId), "install", result.success ? "success" : "failed", result.output);
    return c.json(result);
  });

  // --- Logs (SSE stream) ---

  app.get("/:id/logs", async (c) => {
    const id = c.req.param("id");
    if (!manager.get(id)) return c.json({ error: "instance not found" }, 404);
    const profile = profileFromInstanceId(id);
    const configDir = getConfigDir(profile);
    const exec = getExecutor(id, hostStore);
    const lines = c.req.query("lines") || "100";

    return stream(c, async (s) => {
      for await (const chunk of exec.execStream(`tail -n ${lines} -f "${configDir}/gateway.log" 2>/dev/null`)) {
        await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  });

  // --- Diagnose ---

  app.post("/host/:hostId/diagnose", async (c) => {
    const hostId = c.req.param("hostId") === "local" ? "local" as const : parseInt(c.req.param("hostId"));
    const exec = getHostExecutor(hostId, hostStore);
    const [node, versions, disk] = await Promise.all([
      checkNodeVersion(exec),
      getVersions(exec),
      exec.exec("df -h / 2>/dev/null | tail -1"),
    ]);
    return c.json({ node, openclaw: versions, disk: disk.stdout.trim() });
  });

  return app;
}

function parsePortFromInstance(inst: any): number {
  try {
    const url = new URL(inst.connection.url.replace("ws://", "http://"));
    return parseInt(url.port) || 18789;
  } catch { return 18789; }
}

function logOperation(db: Database.Database, instanceId: string, type: string, status: string, output: string) {
  db.prepare(
    "INSERT INTO operations (instance_id, type, status, output, finished_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).run(instanceId, type, status, output);
}
```

**Step 2: Mount in index.ts**

Add to `packages/server/src/index.ts`:

```typescript
import { lifecycleRoutes } from "./api/lifecycle.js";
// ... after other route mounts:
app.route("/api/lifecycle", lifecycleRoutes(hostStore, manager, db));
```

**Step 3: Run build + existing tests to verify no regressions**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: all pass

**Step 4: Commit**

```
feat: add lifecycle API routes (service control, install, config, logs)
```

---

## Task 7: Frontend — Instance Control Tab

**Files:**
- Create: `packages/web/src/pages/InstanceControl.tsx`
- Modify: `packages/web/src/pages/Instance.tsx` — add "Control" tab

**Step 1: Create InstanceControl component**

This component has 4 sections:
1. **Process Status** — running/stopped indicator + start/stop/restart buttons
2. **Version Info** — current + latest version, upgrade button
3. **Config Editor** — JSON textarea with save button
4. **Live Logs** — SSE-connected log viewer

```typescript
// See implementation in the actual task — this is a React component
// with hooks for each API endpoint, styled with Deep Sea Command tokens
```

Key frontend patterns:
- `useEffect` to poll `/api/lifecycle/:id/status` every 10s
- `fetch` for start/stop/restart/install actions
- `EventSource` for SSE log streaming
- JSON editor with `<textarea>` + JSON validation
- All styled with `bg-s1`, `border-edge`, `text-ink-2`, `text-brand` etc.

**Step 2: Add "Control" tab to Instance.tsx**

Add `"control"` to the Tab type and render `<ControlTab />` when active.

**Step 3: Verify in browser**

Run: `npm run dev` and navigate to an instance detail page, check "Control" tab works.

**Step 4: Commit**

```
feat: add Instance Control tab (process control, version, config editor, logs)
```

---

## Task 8: Integration Testing & Polish

**Files:**
- Create: `packages/server/src/api/__tests__/lifecycle.test.ts`

**Step 1: Write API integration tests**

Test the lifecycle API routes with mocked executor (similar to existing API tests pattern using Hono test client).

Key tests:
- `GET /lifecycle/:id/status` returns process status
- `POST /lifecycle/:id/stop` calls stopProcess
- `GET /lifecycle/host/:hostId/versions` returns version info
- `GET /lifecycle/:id/config-file` returns parsed config
- `PUT /lifecycle/:id/config-file` writes config

**Step 2: Run full test suite**

Run: `npm test`
Expected: all existing + new tests pass

**Step 3: Final commit**

```
test: add lifecycle API integration tests
```

---

## Parallel Execution Strategy

```
Task 1 (Executor types + LocalExec) ─────┐
                                          ├─► Task 3 (Service Control F.2)  ──┐
Task 2 (SshExec + Factory)      ──────────┤                                   │
                                          ├─► Task 4 (Install/Upgrade F.1)    ├─► Task 6 (API Routes)
                                          │                                   │       │
                                          └─► Task 5 (Config Edit F.3)  ──────┘       ▼
                                                                                Task 7 (Frontend)
                                                                                      │
                                                                                      ▼
                                                                                Task 8 (Integration Tests)
```

- **Tasks 1+2** must go first (executor foundation)
- **Tasks 3, 4, 5** are fully independent — can run in parallel
- **Task 6** depends on 3+4+5 (imports all lifecycle modules)
- **Task 7** depends on 6 (needs API endpoints)
- **Task 8** last (integration tests)
