import { describe, it, expect, vi } from "vitest";
import { readRemoteConfig, writeRemoteConfig, getConfigDir, profileFromInstanceId } from "../config.js";
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
    expect(getConfigDir("default")).toBe("$HOME/.openclaw");
    expect(getConfigDir("feishu")).toBe("$HOME/.openclaw-feishu");
    expect(getConfigDir("tg")).toBe("$HOME/.openclaw-tg");
  });
});

describe("profileFromInstanceId", () => {
  it("extracts profile from SSH instance ID", () => {
    expect(profileFromInstanceId("ssh-1-feishu")).toBe("feishu");
    expect(profileFromInstanceId("ssh-1-default")).toBe("default");
    expect(profileFromInstanceId("local-default")).toBe("default");
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
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("openclaw.json"));
  });
});
