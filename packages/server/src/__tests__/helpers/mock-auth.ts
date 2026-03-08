import type { Context, Next } from "hono";
import type { SessionPayload } from "../../auth/types.js";

/**
 * Test middleware that injects a mock admin user into context,
 * bypassing real auth for unit tests.
 */
export function mockAuthMiddleware(user: SessionPayload = { userId: 1, username: "admin", role: "admin" }) {
  return async (c: Context, next: Next) => {
    c.set("user", user);
    return next();
  };
}
