import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password.js";

describe("Password hashing", () => {
  it("hashPassword returns hash and salt as hex strings", () => {
    const { hash, salt } = hashPassword("test123");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(128);
    expect(salt.length).toBe(32);
  });

  it("same password produces different hashes (random salt)", () => {
    const a = hashPassword("test123");
    const b = hashPassword("test123");
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("verifyPassword returns true for correct password", () => {
    const { hash, salt } = hashPassword("correct-password");
    expect(verifyPassword("correct-password", hash, salt)).toBe(true);
  });

  it("verifyPassword returns false for wrong password", () => {
    const { hash, salt } = hashPassword("correct-password");
    expect(verifyPassword("wrong-password", hash, salt)).toBe(false);
  });

  it("handles empty password without crashing", () => {
    const { hash, salt } = hashPassword("");
    expect(verifyPassword("", hash, salt)).toBe(true);
    expect(verifyPassword("notempty", hash, salt)).toBe(false);
  });
});
