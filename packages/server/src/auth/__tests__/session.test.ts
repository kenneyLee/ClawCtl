import { describe, it, expect } from "vitest";
import { createToken, verifyToken } from "../session.js";
import type { SessionPayload } from "../types.js";

describe("Session tokens", () => {
  const secret = "test-secret-key-for-hmac";
  const payload: SessionPayload = { userId: 1, username: "admin", role: "admin" };

  it("createToken returns data.sig format", () => {
    const token = createToken(payload, secret);
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("verifyToken returns original payload for valid token", () => {
    const token = createToken(payload, secret);
    const result = verifyToken(token, secret);
    expect(result).toEqual(payload);
  });

  it("verifyToken returns null for tampered token", () => {
    const token = createToken(payload, secret);
    const tampered = token.replace(/.$/, token.endsWith("x") ? "y" : "x");
    expect(verifyToken(tampered, secret)).toBeNull();
  });

  it("verifyToken returns null for empty/malformed input", () => {
    expect(verifyToken("", secret)).toBeNull();
    expect(verifyToken("nodot", secret)).toBeNull();
  });

  it("verifyToken returns null for wrong secret", () => {
    const token = createToken(payload, secret);
    expect(verifyToken(token, "wrong-secret")).toBeNull();
  });
});
