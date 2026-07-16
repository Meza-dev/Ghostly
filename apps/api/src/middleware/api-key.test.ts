import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signToken } from "../lib/token.js";
import { apiKeyMiddleware } from "./api-key.js";

const STRONG_SECRET = "y".repeat(45);

function makeApp() {
  const app = new Hono();
  app.use("/v1/*", apiKeyMiddleware);
  app.get("/v1/probe", (c) => c.json({ ok: true }));
  return app;
}

describe("apiKeyMiddleware (C2 — un Bearer sin JWT válido NO debe eximir el gate de API key)", () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = STRONG_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it("rechaza (401) un Bearer con firma inválida y sin X-Api-Key", async () => {
    const app = makeApp();
    const res = await app.request("/v1/probe", {
      headers: { Authorization: "Bearer no-es-un-jwt-valido" },
    });
    expect(res.status).toBe(401);
  });

  it("rechaza (401) un Bearer forjado con el secreto default 'ghostly-secret'", async () => {
    const forged = signToken(
      { sub: "00000000-0000-0000-0000-000000000001", email: "admin@ghostly.local", role: "admin" },
      "ghostly-secret",
    );
    const app = makeApp();
    const res = await app.request("/v1/probe", {
      headers: { Authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });

  it("rechaza (401) un ?token= inválido en query (SSE) sin X-Api-Key", async () => {
    const app = makeApp();
    const res = await app.request("/v1/probe?token=basura");
    expect(res.status).toBe(401);
  });

  it("deja pasar (next) un Bearer con JWT válido firmado con el secreto real", async () => {
    const valid = signToken({ sub: "u1", email: "u@x.io", role: "member" }, STRONG_SECRET);
    const app = makeApp();
    const res = await app.request("/v1/probe", {
      headers: { Authorization: `Bearer ${valid}` },
    });
    expect(res.status).toBe(200);
  });
});
