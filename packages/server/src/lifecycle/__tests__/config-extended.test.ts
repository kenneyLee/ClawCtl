import { describe, it, expect, vi } from "vitest";
import { readRemoteConfig, writeRemoteConfig, getConfigDir, profileFromInstanceId } from "../config.js";
import type { CommandExecutor, ExecResult } from "../../executor/types.js";

function mockExec(results: Record<string, ExecResult>): CommandExecutor {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(results)) {
        if (cmd.includes(pattern)) return result;
      }
      return { stdout: "", stderr: "command not found", exitCode: 1 };
    }),
    async *execStream() { yield ""; },
  };
}

describe("readRemoteConfig — extended", () => {
  it("throws parse error on malformed JSON", async () => {
    const exec = mockExec({ "cat": { stdout: "{ not valid json !!!", stderr: "", exitCode: 0 } });
    await expect(readRemoteConfig(exec, "$HOME/.openclaw")).rejects.toThrow();
  });

  it("throws when exec returns non-zero exit code", async () => {
    const exec = mockExec({ "cat": { stdout: "", stderr: "No such file or directory", exitCode: 1 } });
    await expect(readRemoteConfig(exec, "$HOME/.openclaw")).rejects.toThrow(/failed to read config/i);
  });
});

describe("writeRemoteConfig — extended", () => {
  it("includes JSON content in the exec command", async () => {
    const exec = mockExec({ "openclaw.json": { stdout: "", stderr: "", exitCode: 0 } });
    const config = { gateway: { port: 20000 }, agents: ["a"] };
    await writeRemoteConfig(exec, "$HOME/.openclaw", config);

    const call = (exec.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain("openclaw.json");
    expect(call).toContain('"gateway"');
    expect(call).toContain("20000");
  });

  it("throws when exec returns non-zero exit code", async () => {
    const exec = mockExec({});  // default fallback returns exitCode 1
    await expect(writeRemoteConfig(exec, "$HOME/.openclaw", { x: 1 })).rejects.toThrow(/failed to write config/i);
  });
});

describe("getConfigDir — edge cases", () => {
  it("returns ~/.openclaw- for empty string profile", () => {
    expect(getConfigDir("")).toBe("$HOME/.openclaw-");
  });

  it("handles multi-part profile name", () => {
    expect(getConfigDir("my-team")).toBe("$HOME/.openclaw-my-team");
  });
});

describe("profileFromInstanceId — extended", () => {
  it('returns "default" for local-default', () => {
    expect(profileFromInstanceId("local-default")).toBe("default");
  });
});

describe("round-trip read/write", () => {
  it("write then read returns the same config", async () => {
    const config = { gateway: { port: 18789 }, channels: { tg: { enabled: true } } };
    const stored: Record<string, string> = {};

    const exec: CommandExecutor = {
      exec: vi.fn(async (cmd: string) => {
        if (cmd.includes("cat >") || cmd.includes("cat>")) {
          // Extract JSON content written via heredoc
          const match = cmd.match(/'CLAWCTL_EOF'\n([\s\S]*?)\nCLAWCTL_EOF/);
          if (match) stored["config"] = match[1];
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (cmd.startsWith("cat ")) {
          return { stdout: stored["config"] || "", stderr: "", exitCode: stored["config"] ? 0 : 1 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
      async *execStream() { yield ""; },
    };

    await writeRemoteConfig(exec, "$HOME/.openclaw", config);
    const result = await readRemoteConfig(exec, "$HOME/.openclaw");
    expect(result).toEqual(config);
  });
});
