import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de prisma: la key NO existe en la tabla ApiKey, pero hay un admin local.
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    apiKey: { findUnique: vi.fn().mockResolvedValue(null) },
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@ghostly.local",
        role: "admin",
      }),
    },
  },
}));

// Mock de los helpers de host-key (leen ~/.ghostly/auth.json en producción).
vi.mock("./api-key.js", () => ({
  readExpectedApiKey: () => "gk_host_key",
  safeEqual: (a: string, b: string) => a === b,
}));

// Import DESPUÉS del mock (vi.mock está hoisted).
import { authMiddleware } from "./auth.js";

describe("authMiddleware — puente host key → admin local", () => {
  // getJwtSecret() se evalúa al inicio del middleware y exige un secreto fuerte.
  const original = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = "y".repeat(45);
  });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it("resuelve al admin cuando la X-Api-Key coincide con la key de host (sin fila en ApiKey)", async () => {
    const app = new Hono();
    app.use("*", authMiddleware);
    app.get("/probe", (c) => c.json({ user: c.get("user") }));

    const res = await app.request("/probe", {
      headers: { "X-Api-Key": "gk_host_key" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string } };
    expect(body.user).toEqual({ id: "admin-1", email: "admin@ghostly.local", role: "admin" });
  });

  it("sigue rechazando (401) una key que no está en la tabla ni coincide con la de host", async () => {
    const app = new Hono();
    app.use("*", authMiddleware);
    app.get("/probe", (c) => c.json({ ok: true }));

    const res = await app.request("/probe", {
      headers: { "X-Api-Key": "gk_otra_key" },
    });
    expect(res.status).toBe(401);
  });
});
