import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { get, post } from "../lib/api";

export type Role = "admin" | "operator" | "auditor";

export interface AuthUser {
  userId: number;
  username: string;
  role: Role;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Check auth status on mount
    Promise.all([
      get<{ needsSetup: boolean }>("/auth/status"),
      get<AuthUser>("/auth/me").catch(() => null),
    ]).then(([status, me]) => {
      setNeedsSetup(status.needsSetup);
      if (me) setUser(me);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await post<{ user: AuthUser }>("/auth/login", { username, password });
    setUser(res.user);
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const res = await post<{ user: AuthUser }>("/auth/setup", { username, password });
    setUser(res.user);
    setNeedsSetup(false);
  }, []);

  const logout = useCallback(async () => {
    await post("/auth/logout");
    setUser(null);
  }, []);

  return { user, loading, needsSetup, login, setup, logout };
}
