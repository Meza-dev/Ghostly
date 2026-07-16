import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

beforeAll(() => {
  process.env.JWT_SECRET = "z".repeat(45);
});

describe("GET /artifacts/* (C3 — requiere autenticación)", () => {
  it("rechaza (401) una petición sin credenciales", async () => {
    const app = createApp();
    const res = await app.request("/artifacts/run-1/shot.png");
    expect(res.status).toBe(401);
  });

  it("rechaza (401) sin credenciales aun con payload de traversal", async () => {
    const app = createApp();
    const res = await app.request("/artifacts/whatever/..%2f..%2fsecret");
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("JWT_SECRET");
  });
});
