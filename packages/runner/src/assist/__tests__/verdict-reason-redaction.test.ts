/**
 * Redacción de `verdictReason` en la fuente (spec §6, Kanon GHOST-31 — C3).
 *
 * `verdictReason` se ensambla en `pipeline.ts` a partir de texto libre
 * derivado del juez (`outcome.reasoning`) y del `goal` del usuario
 * interpolado en strings (p. ej. `el objetivo "${assist.goal}" implicaba...`).
 * Dos redacciones previas (C1, C2) cerraron el leak en el payload del evento
 * `judge_verdict` (`summarizeJudgeEventForPersistence`), pero `verdictReason`
 * es un campo INDEPENDIENTE que fluye directo desde `AssistedRunResult` hacia
 * `Run.verdictReason` (DB), `RunRecord.verdictReason` (API) y el payload del
 * evento `run_end` — ningún de esos sinks pasaba por la redacción.
 *
 * `redactVerdictReason` es la pieza PURA (sin I/O) que cierra el leak EN LA
 * FUENTE — un único choke point reusado por todos los sinks, en vez de
 * redactar cada uno por separado.
 */
import { describe, expect, it } from "vitest";
import { redactVerdictReason } from "../pipeline.js";

describe("redactVerdictReason (spec §6 — cierra el leak en la fuente, C3)", () => {
  it("returns undefined when verdictReason was never set", () => {
    expect(redactVerdictReason(undefined)).toBeUndefined();
  });

  it("redacts a secret-looking token carried in the judge's reasoning", () => {
    const raw = "El juez confirmó éxito citando token=sk-live-vr-777 en el header.";
    const redacted = redactVerdictReason(raw);

    expect(redacted).toBe("[REDACTED]");
    expect(redacted).not.toContain("sk-live-vr-777");
  });

  it("redacts a secret-looking token carried via the interpolated user goal", () => {
    const raw =
      'Double-check de persistencia falló tras recargar (paso 3): el objetivo ' +
      '"Iniciar sesión usando token=sk-live-vr-777 y guardar la nota" implicaba ' +
      "persistir estado y el dato no sobrevivió la recarga.";
    const redacted = redactVerdictReason(raw);

    expect(redacted).toBe("[REDACTED]");
    expect(redacted).not.toContain("sk-live-vr-777");
  });

  it("leaves non-sensitive verdictReason text untouched (does not over-redact)", () => {
    const raw = "Error bloqueante de la app tras la acción (paso 2): 500 Internal Server Error";
    expect(redactVerdictReason(raw)).toBe(raw);
  });

  it("truncates an unreasonably long verdictReason to keep persisted rows compact", () => {
    const raw = "a".repeat(3000);
    const redacted = redactVerdictReason(raw)!;

    expect(redacted.length).toBeLessThanOrEqual(1000);
    expect(redacted.endsWith("…")).toBe(true);
  });
});
