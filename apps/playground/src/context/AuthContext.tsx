import { createContext, useContext, useState, type ReactNode } from "react";

interface AuthState {
  user: string | null;
  login: (username: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const SESSION_KEY = "pg-user";

export function AuthProvider({ children }: { children: ReactNode }) {
  // Sesión persistida en localStorage: sobrevive un reload (como una app real).
  // Sin esto, el double-check de persistencia de Ghostly (page.goto) desloguea.
  const [user, setUser] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });

  const login = (username: string) => {
    setUser(username);
    try {
      localStorage.setItem(SESSION_KEY, username);
    } catch {
      /* noop */
    }
  };
  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* noop */
    }
  };

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
