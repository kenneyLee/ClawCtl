import { describe, it, expect } from "vitest";
import { LocalExec } from "../local.js";
import { SshExec } from "../ssh.js";

describe("SshExec", () => {
  it("constructs without error", () => {
    const exec = new SshExec({ host: "example.com", port: 22, username: "test", password: "pass" });
    expect(exec).toBeDefined();
  });
});

describe("executor module exports", () => {
  it("exports LocalExec and SshExec", () => {
    expect(LocalExec).toBeDefined();
    expect(SshExec).toBeDefined();
  });
});
