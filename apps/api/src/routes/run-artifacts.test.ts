import { Hono } from "hono";
import { expect, it, vi } from "vitest";

const { configuredRoot, safeParseRunInput } = vi.hoisted(() => ({
  configuredRoot: "/configured/media",
  safeParseRunInput: vi.fn(() => ({ success: false, error: { flatten: () => ({}) } })),
}));
vi.mock("../config.js", () => ({ loadConfig: () => ({ artifactsDir: configuredRoot, assist: {} }) }));
vi.mock("../middleware/auth.js", () => ({ authMiddleware: async (_context: unknown, next: () => Promise<void>) => next() }));
vi.mock("@ghostly-io/runner", async (importOriginal) => ({
  ...await importOriginal<typeof import("@ghostly-io/runner")>(),
  safeParseRunInput,
}));

const { runRouter } = await import("./run.js");

it.each([
  { artifactsDir: "relative-output" },
  { plan: { artifactsDir: "relative-output" } },
  {},
])("always supplies the configured artifact root to persisted runs", async (body) => {
  const app = new Hono().route("/v1", runRouter);
  const response = await app.request("/v1/run", { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(400);
  expect(safeParseRunInput).toHaveBeenLastCalledWith(expect.objectContaining({ artifactsDir: configuredRoot }), expect.any(Object));
});
