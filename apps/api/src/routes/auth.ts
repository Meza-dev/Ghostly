import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { getJwtSecret, signToken } from "../lib/token.js";
import { authMiddleware } from "../middleware/auth.js";
import { msg, pickLang } from "../i18n/pick.js";

export const authRouter = new Hono();

authRouter.post("/auth/login", async (c) => {
  const lang = pickLang(c.req.header("Accept-Language"));
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await c.req.json()) as { email?: unknown; password?: unknown };
  } catch {
    return c.json({ ok: false, error: msg("common.invalidJsonBody", lang) }, 400);
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return c.json({ ok: false, error: msg("auth.emailPasswordRequired", lang) }, 400);
  }

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return c.json({ ok: false, error: msg("auth.invalidCredentials", lang) }, 401);
  }

  const secret = getJwtSecret();
  const token = signToken({ sub: user.id, email: user.email, role: user.role }, secret);

  return c.json({ ok: true, token, user: { id: user.id, email: user.email, role: user.role } });
});

// Registro solo disponible para admin
authRouter.post("/auth/register", authMiddleware, async (c) => {
  const lang = pickLang(c.req.header("Accept-Language"));
  const caller = c.get("user");
  if (caller.role !== "admin") {
    return c.json({ ok: false, error: msg("auth.adminOnlyRegister", lang) }, 403);
  }

  let body: { email?: unknown; password?: unknown; role?: unknown };
  try {
    body = (await c.req.json()) as { email?: unknown; password?: unknown; role?: unknown };
  } catch {
    return c.json({ ok: false, error: msg("common.invalidJsonBody", lang) }, 400);
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return c.json({ ok: false, error: msg("auth.emailPasswordRequired", lang) }, 400);
  }

  const role = body.role === "admin" ? "admin" : "member";

  try {
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash: hashPassword(body.password), role },
    });
    return c.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } }, 201);
  } catch {
    return c.json({ ok: false, error: msg("auth.emailAlreadyRegistered", lang) }, 409);
  }
});

authRouter.get("/auth/me", authMiddleware, (c) => {
  return c.json({ ok: true, user: c.get("user") });
});
