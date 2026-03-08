import { describe, it, expect, vi } from "vitest";
import { getExecutor, getHostExecutor } from "../../executor/factory.js";
import { LocalExec } from "../../executor/local.js";
import { SshExec } from "../../executor/ssh.js";

const mockHostStore = {
  list: vi.fn().mockReturnValue([
    { id: 1, host: "10.0.0.1", port: 22, username: "ubuntu", authMethod: "password" },
  ]),
  getDecryptedCredential: vi.fn().mockReturnValue("secret123"),
} as any;

describe("getExecutor", () => {
  it("returns LocalExec for local-* instance ID", () => {
    const exec = getExecutor("local-default", mockHostStore);
    expect(exec).toBeInstanceOf(LocalExec);
  });

  it("returns SshExec for ssh-{hostId}-* instance ID", () => {
    const exec = getExecutor("ssh-1-feishu", mockHostStore);
    expect(exec).toBeInstanceOf(SshExec);
    expect(mockHostStore.list).toHaveBeenCalled();
    expect(mockHostStore.getDecryptedCredential).toHaveBeenCalledWith(1);
  });

  it("throws for unknown instance prefix", () => {
    expect(() => getExecutor("docker-1-default", mockHostStore)).toThrow(/unknown instance type/i);
  });

  it("throws when host ID is not found in store", () => {
    const emptyStore = {
      list: vi.fn().mockReturnValue([]),
      getDecryptedCredential: vi.fn(),
    } as any;
    expect(() => getExecutor("ssh-99-feishu", emptyStore)).toThrow(/host not found/i);
  });
});

describe("getHostExecutor", () => {
  it('returns LocalExec when hostId is "local"', () => {
    const exec = getHostExecutor("local", mockHostStore);
    expect(exec).toBeInstanceOf(LocalExec);
  });

  it("returns SshExec for a valid numeric hostId", () => {
    const exec = getHostExecutor(1, mockHostStore);
    expect(exec).toBeInstanceOf(SshExec);
    expect(mockHostStore.getDecryptedCredential).toHaveBeenCalledWith(1);
  });

  it("throws when hostId is not found in store", () => {
    const emptyStore = {
      list: vi.fn().mockReturnValue([]),
      getDecryptedCredential: vi.fn(),
    } as any;
    expect(() => getHostExecutor(42, emptyStore)).toThrow(/host not found/i);
  });
});
