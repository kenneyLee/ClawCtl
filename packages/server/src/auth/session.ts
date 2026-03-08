import { createHmac, randomBytes } from "crypto";
import type { SessionPayload } from "./types.js";

// Simple signed token: base64(payload).signature
// No external JWT dependency needed for MVP

let SECRET: string;

export function getSessionSecret(db: { prepare: (sql: string) => any }): string {
  if (SECRET) return SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get() as { value: string } | undefined;
  if (row) {
    SECRET = row.value;
  } else {
    SECRET = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO settings (key, value) VALUES ('session_secret', ?)").run(SECRET);
  }
  return SECRET;
}

export function createToken(payload: SessionPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string, secret: string): SessionPayload | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}
