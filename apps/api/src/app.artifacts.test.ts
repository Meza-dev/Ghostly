import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signToken } from "./lib/token.js";

const { user } = vi.hoisted(() => ({ user: { id: "fixture-user", email: "fixture@example.test", role: "admin" } }));
vi.mock("./lib/prisma.js", () => ({ prisma: { user: { findUnique: async () => user } } }));

const secret = "z".repeat(45);
let directory: string;
let createApp: typeof import("./app.js")["createApp"];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "ghostly-artifacts-"));
  await mkdir(join(directory, "run-1"));
  await writeFile(join(directory, "run-1", "page@fixture.webm"), "fixture video");
  await writeFile(join(directory, "run-1", "step-1-ok.png"), "fixture image");
  vi.stubEnv("JWT_SECRET", secret);
  vi.stubEnv("GHOST_ARTIFACTS_DIR", directory);
  ({ createApp } = await import("./app.js"));
}, 30_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
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

  it.each([
    ["page%40fixture.webm", "video/webm", "fixture video"],
    ["page@fixture.webm", "video/webm", "fixture video"],
    ["step-1-ok.png", "image/png", "fixture image"],
  ])("serves authenticated media %s from the configured root", async (name, mime, content) => {
    const token = signToken({ sub: user.id, email: user.email, role: user.role }, secret);
    const result = await createApp().request(`/artifacts/run-1/${name}?token=${token}`);
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe(mime);
    expect(await result.text()).toBe(content);
  });
});
