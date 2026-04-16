import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

export const apiKeysRouter = new Hono();

apiKeysRouter.use("/api-keys*", authMiddleware);

apiKeysRouter.get("/api-keys", async (c) => {
  const user = c.get("user");
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, key: true },
  });
  // Ocultar los últimos 24 caracteres de la key al listar
  return c.json(keys.map((k) => ({ ...k, key: k.key.slice(0, 8) + "••••••••", createdAt: k.createdAt.toISOString() })));
});

apiKeysRouter.post("/api-keys", async (c) => {
  const user = c.get("user");
  let body: { label?: unknown };
  try {
    body = (await c.req.json()) as { label?: unknown };
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  if (typeof body.label !== "string" || !body.label.trim()) {
    return c.json({ ok: false, error: "label requerido" }, 400);
  }

  const key = randomBytes(32).toString("hex");
  const record = await prisma.apiKey.create({
    data: { userId: user.id, key, label: body.label.trim() },
  });

  // Devolver la key completa SOLO en la creación
  return c.json({ id: record.id, label: record.label, key, createdAt: record.createdAt.toISOString() }, 201);
});

apiKeysRouter.delete("/api-keys/:id", async (c) => {
  const user = c.get("user");
  const record = await prisma.apiKey.findUnique({ where: { id: c.req.param("id") } });
  if (!record || record.userId !== user.id) {
    return c.json({ ok: false, error: "not found" }, 404);
  }
  await prisma.apiKey.delete({ where: { id: record.id } });
  return c.json({ ok: true });
});
