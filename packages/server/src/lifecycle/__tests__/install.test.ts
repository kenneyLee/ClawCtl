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
      "npm view": { stdout: '{"latest":"2026.3.5"}\n', stderr: "", exitCode: 0 },
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
