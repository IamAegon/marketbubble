import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@app/shared";
import * as auth from "../lib/auth";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, setUser: () => {}, logout: () => {} });

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    auth
      .me()
      .then((u) => alive && setUser(u))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const logout = () => {
    auth.logout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>;
}
