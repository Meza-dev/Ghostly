import { afterEach, describe, expect, it } from "vitest";
import { getJwtSecret, signToken, verifyToken } from "./token.js";

const STRONG_SECRET = "x".repeat(45); // secreto fuerte de prueba (>= 32)

describe("getJwtSecret (C2 — guard de secreto JWT)", () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it("lanza si JWT_SECRET no está definido", () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("lanza si JWT_SECRET es el default público 'ghostly-secret'", () => {
    process.env.JWT_SECRET = "ghostly-secret";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("lanza si JWT_SECRET es demasiado corto (< 32)", () => {
    process.env.JWT_SECRET = "corto";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("devuelve el secreto cuando es fuerte (>= 32)", () => {
    process.env.JWT_SECRET = STRONG_SECRET;
    expect(getJwtSecret()).toBe(STRONG_SECRET);
  });
});

describe("verifyToken (C2 — un token firmado con el default no autentica bajo un secreto real)", () => {
  it("rechaza un token forjado con 'ghostly-secret' cuando el server usa un secreto real distinto", () => {
    const forged = signToken(
      { sub: "00000000-0000-0000-0000-000000000001", email: "admin@ghostly.local", role: "admin" },
      "ghostly-secret",
    );
    expect(verifyToken(forged, STRONG_SECRET)).toBeNull();
  });
});
