import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * ~/.ghostly/auth.json es la fuente VIVA de credenciales en el host. El env del
 * cliente MCP (GHOST_API_KEY/GHOST_API_URL) es un snapshot horneado en install:
 * si la key rota después (keygen, reinstall), ese env queda stale y la API
 * devuelve 401. Prioridad: argumento explícito > auth.json > env.
 */
function authFromDisk(): { apiKey?: string; apiUrl?: string } {
  try {
    const raw = readFileSync(resolve(homedir(), ".ghostly", "auth.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const { apiKey, apiUrl } = parsed as { apiKey?: unknown; apiUrl?: unknown };
      return {
        ...(typeof apiKey === "string" && apiKey.trim() ? { apiKey } : {}),
        ...(typeof apiUrl === "string" && apiUrl.trim() ? { apiUrl } : {}),
      };
    }
  } catch {
    // Sin auth.json (o ilegible) — se cae al env.
  }
  return {};
}

/** Base URL de la API Ghostly (sin barra final). */
export function apiUrlFromEnv(apiUrl?: string): string {
  const url = apiUrl ?? authFromDisk().apiUrl ?? process.env.GHOST_API_URL ?? "http://localhost:4000";
  return url.replace(/\/+$/, "");
}

/** Headers de auth: JWT → Bearer; API key de BD → X-Api-Key. */
export function authHeader(apiKey?: string): Record<string, string> {
  const token =
    apiKey ?? authFromDisk().apiKey ?? process.env.GHOST_API_KEY ?? process.env.GHOST_API_TOKEN;
  if (!token) return {};
  const isJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  return isJwt
    ? { Authorization: `Bearer ${token}` }
    : { "X-Api-Key": token };
}
