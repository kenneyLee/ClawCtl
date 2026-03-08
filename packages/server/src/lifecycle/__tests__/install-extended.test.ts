import { describe, it, expect, vi } from "vitest";
import { checkNodeVersion, getVersions, installOpenClaw } from "../install.js";
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
  it("parses v20.0.0 as insufficient (major < 22)", async () => {
    const exec = mockExec({ "node --version": { stdout: "v20.0.0\n", stderr: "", exitCode: 0 } });
    const v = await checkNodeVersion(exec);
    expect(v.installed).toBe(true);
    expect(v.version).toBe("20.0.0");
    expect(v.sufficient).toBe(false);
  });
});

describe("getVersions", () => {
  it("returns undefined installed when openclaw not installed", async () => {
    const exec = mockExec({
      "openclaw --version": { stdout: "", stderr: "command not found", exitCode: 127 },
      "npm view": { stdout: '{"latest":"2026.3.5"}\n', stderr: "", exitCode: 0 },
    });
    const v = await getVersions(exec);
    expect(v.installed).toBeUndefined();
    expect(v.latest).toBe("2026.3.5");
    expect(v.updateAvailable).toBe(false);
  });

  it("returns undefined latest when npm view fails", async () => {
    const exec = mockExec({
      "openclaw --version": { stdout: "2026.3.3\n", stderr: "", exitCode: 0 },
      "npm view": { stdout: "", stderr: "npm ERR!", exitCode: 1 },
    });
    const v = await getVersions(exec);
    expect(v.installed).toBe("2026.3.3");
    expect(v.latest).toBeUndefined();
    expect(v.updateAvailable).toBe(false);
  });

  it("returns updateAvailable false when versions are the same", async () => {
    const exec = mockExec({
      "openclaw --version": { stdout: "2026.3.5\n", stderr: "", exitCode: 0 },
      "npm view": { stdout: '{"latest":"2026.3.5"}\n', stderr: "", exitCode: 0 },
    });
    const v = await getVersions(exec);
    expect(v.installed).toBe("2026.3.5");
    expect(v.latest).toBe("2026.3.5");
    expect(v.updateAvailable).toBe(false);
  });
});

describe("installOpenClaw", () => {
  it("includes specific version in command when provided", async () => {
    const execFn = vi.fn(async () => ({ stdout: "added 1 package\n", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    const r = await installOpenClaw(exec, "2026.3.3");
    expect(r.success).toBe(true);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("openclaw@2026.3.3"), expect.anything());
  });

  it("returns success false on non-zero exit code", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "npm ERR! 404\n", exitCode: 1 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    const r = await installOpenClaw(exec);
    expect(r.success).toBe(false);
    expect(r.output).toContain("npm ERR!");
  });
});
