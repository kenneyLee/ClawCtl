import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

describe("Host credential encryption", () => {
  const secret = "test-secret-key";

  it("encrypts and decrypts a password", () => {
    const password = "my-ssh-password";
    const encrypted = encrypt(password, secret);
    expect(encrypted).not.toBe(password);
    expect(decrypt(encrypted, secret)).toBe(password);
  });

  it("encrypts and decrypts a private key", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-content\n-----END OPENSSH PRIVATE KEY-----";
    const encrypted = encrypt(key, secret);
    expect(decrypt(encrypted, secret)).toBe(key);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const plaintext = "same-text";
    const a = encrypt(plaintext, secret);
    const b = encrypt(plaintext, secret);
    expect(a).not.toBe(b);
    expect(decrypt(a, secret)).toBe(plaintext);
    expect(decrypt(b, secret)).toBe(plaintext);
  });

  it("fails to decrypt with wrong secret", () => {
    const encrypted = encrypt("data", secret);
    expect(() => decrypt(encrypted, "wrong-secret")).toThrow();
  });
});
