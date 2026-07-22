import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir: string;

// Redirige ~/.ghostly a un temp dir para que writeAuth no toque el auth.json real.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir };
});

const { ensureJwtSecret, generateApiKey, readAuth } = await import("./auth.js");
type GhostAuth = Awaited<ReturnType<typeof readAuth>> & object;

describe("generateApiKey", () => {
  it("defaults to a prefixed, high-entropy, URL-safe key", () => {
    const key = generateApiKey();
    expect(key.startsWith("gk_")).toBe(true);
    const suffix = key.slice(3);
    // base64url(32 bytes) = 43 chars, alfabeto URL-safe (sin + / =).
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns a different key on each call", () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  it("still supports uuid mode (backward compat for existing installs)", () => {
    expect(generateApiKey("uuid")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("still supports token (hex) mode", () => {
    expect(generateApiKey("token")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ensureJwtSecret", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-auth-"));
    homeDir = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const baseAuth = (): GhostAuth => ({ apiKey: "k", apiUrl: "u" }) as GhostAuth;

  it("generates a strong (>= 32 char) secret and persists it when missing", () => {
    const auth = baseAuth();
    const secret = ensureJwtSecret(auth);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(auth.extraEnv?.JWT_SECRET).toBe(secret);
    // Persisted to auth.json under the temp home.
    expect(readAuth()?.extraEnv?.JWT_SECRET).toBe(secret);
  });

  it("reuses an existing valid secret instead of regenerating", () => {
    const existing = "x".repeat(40);
    const auth = { ...baseAuth(), extraEnv: { JWT_SECRET: existing } } as GhostAuth;
    expect(ensureJwtSecret(auth)).toBe(existing);
  });

  it("replaces a too-short secret with a strong one", () => {
    const auth = { ...baseAuth(), extraEnv: { JWT_SECRET: "short" } } as GhostAuth;
    const secret = ensureJwtSecret(auth);
    expect(secret).not.toBe("short");
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });
});
