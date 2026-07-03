/**
 * Boundary de redacción — contrato puro (Kanon GHOST-35, spec §6 hardening).
 *
 * `redactOrTruncateText`/`redactOrTruncateList` viven en `./redaction.ts` y
 * son el ÚNICO choke point de redacción de texto libre del proyecto.
 * `judge.ts` y `pipeline.ts` los re-exportan/consumen, pero la fuente de
 * verdad y su test dedicado viven acá. Estos tests reemplazan la cobertura
 * ad-hoc que antes vivía implícita en `judge-event-persistence.test.ts` —
 * ahora el contrato tiene su propio archivo porque dejó de ser un detalle
 * interno de `judge.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  redactOrTruncateList,
  redactOrTruncateText,
  SENSITIVE_TEXT_WORDS,
} from "../redaction.js";

describe("redactOrTruncateText (boundary único de redacción de texto libre)", () => {
  it("redacts text containing a sensitive keyword", () => {
    expect(redactOrTruncateText("el token=sk-live-boundary-000 quedó expuesto")).toBe(
      "[REDACTED]",
    );
  });

  it("leaves non-sensitive text untouched", () => {
    const text = "500 Internal Server Error en POST /save";
    expect(redactOrTruncateText(text)).toBe(text);
  });

  it("truncates long non-sensitive text to 1000 chars with an ellipsis", () => {
    const long = "a".repeat(3000);
    const result = redactOrTruncateText(long);
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result.endsWith("…")).toBe(true);
  });

  it("is case-insensitive when matching sensitive keywords", () => {
    expect(redactOrTruncateText("Authorization: Bearer xyz")).toBe("[REDACTED]");
  });
});

describe("redactOrTruncateList", () => {
  it("applies redactOrTruncateText to every entry independently", () => {
    const result = redactOrTruncateList([
      "safe entry",
      "leaks a secret=hunter2",
    ]);
    expect(result).toEqual(["safe entry", "[REDACTED]"]);
  });
});

describe("SENSITIVE_TEXT_WORDS (single source of truth)", () => {
  it("is exported as a non-empty readonly word list consumable by apps/api", () => {
    expect(SENSITIVE_TEXT_WORDS.length).toBeGreaterThan(0);
    expect(SENSITIVE_TEXT_WORDS).toContain("password");
    expect(SENSITIVE_TEXT_WORDS).toContain("token");
  });
});
