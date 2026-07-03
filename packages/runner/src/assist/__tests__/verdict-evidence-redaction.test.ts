/**
 * Redacción de `verdictEvidence` en la fuente (W15, forward-carry del review
 * de GHOST-31 — Kanon GHOST-35).
 *
 * `verdictEvidence` es un `PageError[]` cuyo campo `.message` viene de texto
 * crudo de la página bajo prueba (consola/DOM/red — ver `observer.ts`).
 * `redactVerdictEvidence` es la pieza PURA que cierra el gap EN LA FUENTE, el
 * mismo patrón elegido para `verdictReason` en el fix C3 de GHOST-31.
 */
import { describe, expect, it } from "vitest";
import { redactVerdictEvidence } from "../pipeline.js";
import type { PageError } from "../types.js";

function pageError(message: string, overrides: Partial<PageError> = {}): PageError {
  return {
    source: "console",
    severity: "blocking",
    message,
    observedAtStep: 2,
    ...overrides,
  };
}

describe("redactVerdictEvidence (W15 — cierra el gap en la fuente)", () => {
  it("returns undefined when there is no evidence", () => {
    expect(redactVerdictEvidence(undefined)).toBeUndefined();
  });

  it("returns an empty array untouched when evidence is empty", () => {
    expect(redactVerdictEvidence([])).toEqual([]);
  });

  it("redacts a secret-looking token carried in a page error message", () => {
    const evidence = [pageError("pageerror: token=sk-live-boundary-000 filtrado en consola")];
    const redacted = redactVerdictEvidence(evidence)!;

    expect(redacted[0]!.message).toBe("[REDACTED]");
    expect(JSON.stringify(redacted)).not.toContain("sk-live-boundary-000");
  });

  it("leaves non-sensitive page error messages untouched (does not over-redact)", () => {
    const evidence = [pageError("POST /save → 500")];
    expect(redactVerdictEvidence(evidence)).toEqual(evidence);
  });

  it("redacts each entry of a multi-error array independently", () => {
    const evidence = [
      pageError("500 Internal Server Error", { observedAtStep: 1 }),
      pageError("token=sk-live-multi-999 expuesto en el header", { observedAtStep: 2 }),
    ];
    const redacted = redactVerdictEvidence(evidence)!;

    expect(redacted[0]!.message).toBe("500 Internal Server Error");
    expect(redacted[1]!.message).toBe("[REDACTED]");
  });

  it("preserves all non-message fields of each PageError untouched", () => {
    const evidence = [
      pageError("500 Internal Server Error", {
        source: "network",
        detail: { url: "/save", status: 500 },
        observedAtStep: 3,
      }),
    ];
    const redacted = redactVerdictEvidence(evidence)!;

    expect(redacted[0]).toEqual(evidence[0]);
  });
});
