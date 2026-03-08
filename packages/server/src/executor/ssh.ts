import { Client } from "ssh2";
import type { CommandExecutor, ExecResult, ExecOptions } from "./types.js";

export interface SshConfig {
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
