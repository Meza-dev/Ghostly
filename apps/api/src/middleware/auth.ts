import type { Context, Next } from "hono";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/token.js";

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
  const secret = process.env.JWT_SECRET ?? "ghosttester-secret";

  // Intentar Bearer JWT
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token, secret);
    if (payload) {
      c.set("user", { id: payload.sub, email: payload.email, role: payload.role });
      return next();
    }
    return c.json({ ok: false, error: "token inválido o expirado" }, 401);
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
    return c.json({ ok: false, error: "API Key inválida" }, 401);
  }

  return c.json({ ok: false, error: "se requiere autenticación" }, 401);
}
