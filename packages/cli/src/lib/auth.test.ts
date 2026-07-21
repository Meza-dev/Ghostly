import { describe, expect, it } from "vitest";
import { generateApiKey } from "./auth.js";

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
