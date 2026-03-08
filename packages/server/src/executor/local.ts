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
