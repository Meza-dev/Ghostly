/**
 * Persistencia de veredictos del juez como `RunEvent` (spec §4.3
 * "Observabilidad" + spec §6, Kanon GHOST-31).
 *
 * `summarizeJudgeEventForPersistence` es la pieza PURA (sin I/O, sin Prisma)
 * que transforma un `JudgeEvent` crudo del pipeline en un payload compacto y
 * saneado apto para guardarse como `RunEvent` y publicarse por el bus SSE.
 * apps/api no tiene test runner, así que esta lógica vive acá (mismo patrón
 * que el resto del contrato del juez en `judge.ts`) y `apps/api/src/routes/
 * run.ts` solo la invoca.
 */
import { describe, expect, it } from "vitest";
import { summarizeJudgeEventForPersistence } from "../judge.js";
import type { JudgeEvent } from "../types.js";

function baseEvent(overrides: Partial<JudgeEvent> = {}): JudgeEvent {
  return {
    reason: "victory-candidate",
    dossierSummary: {
      goal: "Guardar la nota",
      reason: "victory-candidate",
      recentActionsCount: 3,
      pageErrorsCount: 0,
    },
    verdict: {
      verdict: "success",
      confidence: "high",
      reasoning: "El texto 'Guardado' persiste tras recargar la página.",
      evidence: ["deterministicChecks: victory.textIncludes=true"],
    },
    at: "2026-07-02T12:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeJudgeEventForPersistence (RunEvent shaping, spec §4.3/§6)", () => {
  it("shapes a terminal verdict into a persistable payload with all dossier/verdict fields, running the goal through the same redaction contract as reasoning/evidence", () => {
    const event = baseEvent();
    const payload = summarizeJudgeEventForPersistence(event);

    expect(payload).toEqual({
      reason: "victory-candidate",
      at: "2026-07-02T12:00:00.000Z",
      dossierSummary: {
        // No sensitive keyword present — same contract as `redactGoal` in
        // apps/api/src/lib/redact-assist.ts: passes through untouched.
        goal: "Guardar la nota",
        reason: "victory-candidate",
        recentActionsCount: 3,
        pageErrorsCount: 0,
      },
      verdict: "success",
      confidence: "high",
      reasoning: "El texto 'Guardado' persiste tras recargar la página.",
      evidence: ["deterministicChecks: victory.textIncludes=true"],
    });
  });

  it("never leaks a secret-looking token from the user goal into the persisted payload", () => {
    const event = baseEvent({
      dossierSummary: {
        goal: "Iniciar sesión usando token=sk-live-abc123 y guardar la nota",
        reason: "victory-candidate",
        recentActionsCount: 3,
        pageErrorsCount: 0,
      },
    });

    const payload = summarizeJudgeEventForPersistence(event);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("sk-live-abc123");
    expect(payload.dossierSummary).toEqual({
      goal: "[REDACTED]",
      reason: "victory-candidate",
      recentActionsCount: 3,
      pageErrorsCount: 0,
    });
  });

  it("includes hint only when verdict is 'continue'", () => {
    const event = baseEvent({
      reason: "stalled",
      verdict: {
        verdict: "continue",
        confidence: "medium",
        reasoning: "Hay un modal de confirmación tapando el botón; cerralo primero.",
        evidence: ["dialog role=alertdialog visible"],
        hint: "cerrá el modal de confirmación antes de continuar",
      },
    });

    const payload = summarizeJudgeEventForPersistence(event);

    expect(payload.hint).toBe("cerrá el modal de confirmación antes de continuar");
    expect(payload.verdict).toBe("continue");
  });

  it("omits hint entirely for terminal verdicts (never leaks an undefined key)", () => {
    const payload = summarizeJudgeEventForPersistence(baseEvent());
    expect("hint" in payload).toBe(false);
  });

  it("redacts sensitive keywords from reasoning and evidence text before persisting", () => {
    const event = baseEvent({
      verdict: {
        verdict: "fail-app-bug",
        confidence: "high",
        reasoning: "La respuesta trajo un token de autorización expuesto en el body del 500.",
        evidence: ["pageErrors[0]: password=hunter2 filtrado en el log de consola"],
      },
    });

    const payload = summarizeJudgeEventForPersistence(event);

    expect(payload.reasoning).toBe("[REDACTED]");
    expect(payload.evidence).toEqual(["[REDACTED]"]);
  });

  it("leaves non-sensitive reasoning and evidence untouched (does not over-redact)", () => {
    const payload = summarizeJudgeEventForPersistence(baseEvent());
    expect(payload.reasoning).toBe("El texto 'Guardado' persiste tras recargar la página.");
    expect(payload.evidence).toEqual(["deterministicChecks: victory.textIncludes=true"]);
  });

  it("truncates an unreasonably long reasoning string to keep RunEvent rows compact", () => {
    const longReasoning = "a".repeat(3000);
    const event = baseEvent({
      verdict: {
        verdict: "inconclusive",
        confidence: "low",
        reasoning: longReasoning,
        evidence: [],
      },
    });

    const payload = summarizeJudgeEventForPersistence(event);

    expect((payload.reasoning as string).length).toBeLessThanOrEqual(1000);
    expect((payload.reasoning as string).endsWith("…")).toBe(true);
  });
});
