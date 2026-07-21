/**
 * Redacción del GOAL a nivel token (GHOST-58 follow-up): el goal es el título
 * del run y texto autorado por el usuario. `redactOrTruncateText` lo nukeaba
 * entero a `[REDACTED]` si contenía "password" — inutilizaba el título.
 * `redactGoalText` redacta SOLO el valor del secreto y conserva el resto.
 */
import { describe, expect, it } from "vitest";
import { redactGoalText, redactSecretValues } from "../redaction.js";

describe("redactSecretValues (redacción a nivel token)", () => {
  it("redacta el valor tras una palabra sensible pero conserva la palabra", () => {
    expect(redactSecretValues("token: abc123")).toBe("token: [REDACTED]");
  });

  it("no toca un texto sin palabras sensibles", () => {
    const plain = "Go to Clientes and create a client named Acme SA";
    expect(redactSecretValues(plain)).toBe(plain);
  });

  it("redacta valores con comillas conservando la estructura", () => {
    expect(redactSecretValues('password "admin"')).toContain("password");
    expect(redactSecretValues('password "admin"')).toContain("[REDACTED]");
    expect(redactSecretValues('password "admin"')).not.toContain("admin");
  });
});

describe("redactGoalText (título del run)", () => {
  const goal =
    'Log in as "admin" with password "admin". Go to Clientes, click "Nuevo cliente" and save.';

  it("conserva el goal legible, redactando solo el secreto (no lo nukea entero)", () => {
    const out = redactGoalText(goal);
    expect(out).not.toBe("[REDACTED]");
    expect(out).toContain("Log in as");
    expect(out).toContain("Clientes");
    expect(out).toContain("[REDACTED]");
  });

  it("no redacta el username 'admin' (no está tras una palabra sensible)", () => {
    // "Log in as \"admin\"" queda; solo el valor tras "password" se tapa.
    expect(redactGoalText(goal)).toContain('Log in as "admin"');
  });

  it("deja intacto un goal sin secretos", () => {
    const clean = "Create a client named Acme SA and confirm the success toast";
    expect(redactGoalText(clean)).toBe(clean);
  });
});
