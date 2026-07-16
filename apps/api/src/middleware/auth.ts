import type { Context, Next } from "hono";
import { prisma } from "../lib/prisma.js";
import { getJwtSecret, verifyToken } from "../lib/token.js";
import { msg, pickLang } from "../i18n/pick.js";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const lang = pickLang(c.req.header("Accept-Language"));
  const secret = getJwtSecret();

  // Intentar Bearer JWT (Authorization header o ?token= query param para SSE/EventSource).
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : queryToken;
  if (bearerToken) {
    const token = bearerToken;
    const payload = verifyToken(token, secret);
    if (!payload) {
      return c.json({ ok: false, error: msg("auth.invalidOrExpiredToken", lang) }, 401);
    }
    // El JWT puede ser criptográficamente válido pero apuntar a un user
    // que ya no existe (BD recreada, usuario eliminado). Validamos existencia
    // para evitar violaciones de FK aguas abajo (P2003 al crear Project/Run).
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      return c.json({ ok: false, error: msg("auth.sessionExpired", lang) }, 401);
    }
    c.set("user", user);
    return next();
  }

  // Intentar X-Api-Key
  const apiKey = c.req.header("X-Api-Key");
  if (apiKey) {
    const record = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { user: { select: { id: true, email: true, role: true } } },
    });
    if (record) {
      c.set("user", { id: record.user.id, email: record.user.email, role: record.user.role });
      return next();
    }
    return c.json({ ok: false, error: msg("auth.invalidApiKey", lang) }, 401);
  }

  return c.json({ ok: false, error: msg("auth.authRequired", lang) }, 401);
}
