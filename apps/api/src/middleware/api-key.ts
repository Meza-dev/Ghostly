import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Context, Next } from "hono";

type AuthFileShape = {
  apiKey?: string;
};

function readExpectedApiKey(): string | null {
  const authPath = resolve(homedir(), ".ghostly", "auth.json");
  if (!existsSync(authPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as AuthFileShape;
    const key = parsed.apiKey?.trim();
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export async function apiKeyMiddleware(c: Context, next: Next) {
  // Permitir rutas de auth sin x-api-key para no bloquear el login web.
  if (c.req.path.startsWith("/v1/auth/")) {
    return next();
  }

  // Si llega sesión por JWT (header o query token para SSE), no exigir x-api-key.
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const hasBearer = authHeader?.startsWith("Bearer ");
  const hasQueryToken = Boolean(c.req.query("token"));
  if (hasBearer || hasQueryToken) {
    return next();
  }

  const expected = readExpectedApiKey();
  const provided = c.req.header("x-api-key")?.trim();

  if (!expected || !provided || provided !== expected) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  return next();
}
