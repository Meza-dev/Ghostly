import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Context, Next } from "hono";
import { getJwtSecret, verifyToken } from "../lib/token.js";

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

  // Si llega una sesión por JWT (header o query token para SSE) y el token es
  // VÁLIDO, no exigimos x-api-key. La mera presencia de un Bearer no basta:
  // se debe verificar la firma antes de eximir el gate (C2). authMiddleware
  // vuelve a validar aguas abajo — controles independientes, defensa en capas.
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : c.req.query("token");
  if (bearerToken && verifyToken(bearerToken, getJwtSecret())) {
    return next();
  }
  // Si el Bearer/token está presente pero es inválido, NO se exime: caemos al
  // chequeo de la API key de host (que fallará si no hay X-Api-Key válida).

  const expected = readExpectedApiKey();
  const provided = c.req.header("x-api-key")?.trim();

  if (!expected || !provided || provided !== expected) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  return next();
}
