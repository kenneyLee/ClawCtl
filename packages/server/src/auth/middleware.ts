import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifyToken } from "./session.js";
import { ROLE_PERMISSIONS, type Role, type SessionPayload } from "./types.js";

const TOKEN_COOKIE = "clawctl_token";

// Extend Hono context with user info
declare module "hono" {
  interface ContextVariableMap {
    user: SessionPayload;
  }
}

export function authMiddleware(secret: string) {
  return async (c: Context, next: Next) => {
    // Allow auth routes without token
    const path = c.req.path;
    if (path === "/api/auth/login" || path === "/api/auth/setup" || path === "/api/auth/status" || path === "/api/health") {
      return next();
    }

    // Check cookie first, then Authorization header
    const cookieToken = getCookie(c, TOKEN_COOKIE);
    const headerToken = c.req.header("Authorization")?.replace("Bearer ", "");
    const token = cookieToken || headerToken;

    if (!token) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const payload = verifyToken(token, secret);
    if (!payload) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    c.set("user", payload);
    return next();
  };
}

export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: `Requires role: ${roles.join(" or ")}` }, 403);
    }
    return next();
  };
}

export function requireWrite(resource: string) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }
    const perms = ROLE_PERMISSIONS[user.role];
    if (!perms.write.includes("*") && !perms.write.includes(resource)) {
      return c.json({ error: `No write permission for ${resource}` }, 403);
    }
    return next();
  };
}
