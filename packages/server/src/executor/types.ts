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
