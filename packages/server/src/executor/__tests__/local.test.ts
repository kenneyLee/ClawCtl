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
