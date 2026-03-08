import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";

vi.mock("fs");
vi.mock("os");

const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockHomedir = vi.mocked(os.homedir);

const { discoverLocalInstances } = await import("../discovery.js");

describe("discoverLocalInstances", () => {
  beforeEach(() => {
    mockHomedir.mockReturnValue("/home/testuser");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("discovers default .openclaw instance", () => {
    mockReaddirSync.mockReturnValue([".openclaw"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ gateway: { port: 18789 } }));

    const result = discoverLocalInstances();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("local-default");
    expect(result[0].url).toBe("ws://127.0.0.1:18789");
    expect(result[0].label).toBe("default");
  });

  it("discovers named instance .openclaw-feishu", () => {
    mockReaddirSync.mockReturnValue([".openclaw-feishu"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ gateway: { port: 18989 } }));

    const result = discoverLocalInstances();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("local-feishu");
    expect(result[0].url).toBe("ws://127.0.0.1:18989");
    expect(result[0].label).toBe("feishu");
  });

  it("discovers multiple instances", () => {
    mockReaddirSync.mockReturnValue([".openclaw", ".openclaw-feishu", ".openclaw-tg"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((filePath: any) => {
      if (filePath.includes("-feishu")) return JSON.stringify({ gateway: { port: 18989 } });
      if (filePath.includes("-tg")) return JSON.stringify({ gateway: { port: 18889 } });
      return JSON.stringify({ gateway: { port: 18789 } });
    });

    const result = discoverLocalInstances();
    expect(result).toHaveLength(3);
  });

  it("skips directory without openclaw.json", () => {
    mockReaddirSync.mockReturnValue([".openclaw"] as any);
    mockExistsSync.mockReturnValue(false);

    const result = discoverLocalInstances();
    expect(result).toHaveLength(0);
  });

  it("skips malformed JSON gracefully", () => {
    mockReaddirSync.mockReturnValue([".openclaw"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json{{{");

    const result = discoverLocalInstances();
    expect(result).toHaveLength(0);
  });

  it("uses default port 18789 when not specified", () => {
    mockReaddirSync.mockReturnValue([".openclaw"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    const result = discoverLocalInstances();
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("ws://127.0.0.1:18789");
  });

  it("returns empty array when home has no .openclaw dirs", () => {
    mockReaddirSync.mockReturnValue([".bashrc", "Documents", ".config"] as any);

    const result = discoverLocalInstances();
    expect(result).toHaveLength(0);
  });

  it("extracts gateway token from config", () => {
    mockReaddirSync.mockReturnValue([".openclaw"] as any);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ gateway: { port: 18789, token: "secret" } }));

    const result = discoverLocalInstances();
    expect(result[0].token).toBe("secret");
  });
});
