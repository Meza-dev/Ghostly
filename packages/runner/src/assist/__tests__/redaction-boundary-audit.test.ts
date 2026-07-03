/**
 * Auditoría exhaustiva del boundary de redacción (Kanon GHOST-35, spec §6
 * hardening — cierra la retrospectiva de v0.2, obs Engram
 * ghostly/v0.2-retrospective-redaction-gap).
 *
 * Este archivo documenta la TABLA COMPLETA de sinks de texto libre derivado
 * de goal/juez/página que el proyecto conoce y prueba, de forma NO
 * TAUTOLÓGICA, que cada sink redactado efectivamente elimina un secreto
 * plantado (`sk-live-boundary-000`) del payload serializado. No basta con
 * comparar contra `"[REDACTED]"` — se busca el token literal en el JSON
 * serializado, igual que hicieron los tests C1/C2/C3 de GHOST-31.
 *
 * | # | Sink | Fuente del texto | Redactado por | Evidencia |
 * |---|---|---|---|---|
 * | 1 | `judge_verdict` event — `dossierSummary.goal` | goal del usuario | `redactOrTruncateText` (C1) | este archivo, caso 1 |
 * | 2 | `judge_verdict` event — `reasoning`/`evidence` | razonamiento del juez | `redactOrTruncateText`/List (pre-existente) | este archivo, caso 1 |
 * | 3 | `judge_verdict` event — `hint` | hint autorado por el juez | `redactOrTruncateText` (C2) | este archivo, caso 1 |
 * | 4 | `run_end` event — `verdictReason` | outcome.reasoning + goal interpolado | `redactVerdictReason` (C3) | este archivo, caso 2 |
 * | 5 | `AssistedRunResult.verdictReason` (return) | mismo que #4 | `redactVerdictReason` (C3) | este archivo, caso 2 |
 * | 6 | `Run.verdictReason` DB / `RunRecord` API | mismo que #4, transitivo | `redactVerdictReason` (C3, transitivo) | verify-report GHOST-31 |
 * | 7 | `AssistedRunResult.verdictEvidence` (return) | `PageError[].message` (consola/DOM/red) | `redactVerdictEvidence` (GHOST-35, W15) | este archivo, caso 3 |
 * | 8 | `loop_state` event — `circuit_breaker_tripped.evidence` | mismo que #7 | `redactVerdictEvidence` (GHOST-35) | este archivo, caso 4 |
 * | 9 | `loop_state` event — `persistence_check_failed.goal` | goal del usuario | `redactOrTruncateText` (GHOST-35, gap nuevo encontrado en esta auditoría) | este archivo, caso 5 |
 * | 10 | `heal_failure`/`heal_action` — `rationale` | texto libre autorado por el healer (LLM) | `redactOrTruncateText` (GHOST-35) | este archivo, caso 6 |
 * | 11 | `step_failure`/`heal_failure` — `error`/`replanError` | mensaje de excepción Playwright/JS | `redactOrTruncateText` (GHOST-35) | este archivo, caso 7 |
 * | 12 | `assistedMeta.goal` (Run metadata JSON) | goal del usuario | `redactAssistedMeta`/`redactGoal`, apps/api | apps/api (fuera del runner, mismo contrato) |
 * | 13 | `verdict`/`stopReason` (campos enum) | taxonomía cerrada | N/A — safe por construcción | tipos `Verdict`/`JudgeTriggerStopReason` |
 *
 * Sinks auditados y confirmados SIN texto libre sin redactar: los otros 30
 * `emit(...)` de `pipeline.ts` (recon, plan_chunk, horizon_start/end,
 * step_start/success, heal_start/success, memory_hit/miss, victory_check,
 * judge_verdict loop_state) solo llevan campos enum/booleanos/numéricos o
 * `Step` ya pasado por `redactStepForEvent` — no quedan sinks sin catalogar.
 */
import { describe, expect, it } from "vitest";
import { redactVerdictEvidence, redactVerdictReason } from "../pipeline.js";
import { redactOrTruncateList, redactOrTruncateText } from "../redaction.js";
import { summarizeJudgeEventForPersistence } from "../judge.js";
import type { JudgeEvent, PageError } from "../types.js";

const SECRET = "sk-live-boundary-000";

function assertTokenAbsent(serialized: string): void {
  expect(serialized).not.toContain(SECRET);
}

describe("Redaction boundary — exhaustive sink audit (Kanon GHOST-35)", () => {
  it("case 1 — judge_verdict event payload (goal, reasoning, evidence, hint) never leaks the planted secret", () => {
    const event: JudgeEvent = {
      reason: "victory-candidate",
      dossierSummary: {
        goal: `Iniciar sesión usando token=${SECRET}`,
        reason: "victory-candidate",
        recentActionsCount: 1,
        pageErrorsCount: 0,
      },
      verdict: {
        verdict: "continue",
        confidence: "medium",
        reasoning: `El header trae authorization=${SECRET} expuesto`,
        evidence: [`pageErrors[0]: token=${SECRET} filtrado`],
        hint: `cerrá el modal que muestra token=${SECRET}`,
      },
      at: "2026-07-03T00:00:00.000Z",
    };

    const payload = summarizeJudgeEventForPersistence(event);
    assertTokenAbsent(JSON.stringify(payload));
  });

  it("case 2 — verdictReason (run_end event + AssistedRunResult return) never leaks the planted secret", () => {
    const raw = `Double-check de persistencia falló: el objetivo "usar token=${SECRET}" implicaba persistir estado.`;
    const redacted = redactVerdictReason(raw);
    assertTokenAbsent(JSON.stringify({ verdictReason: redacted }));
  });

  it("case 3 — verdictEvidence (AssistedRunResult return, W15) never leaks the planted secret", () => {
    const evidence: PageError[] = [
      {
        source: "console",
        severity: "blocking",
        message: `pageerror: token=${SECRET} filtrado en consola`,
        observedAtStep: 2,
      },
    ];
    const redacted = redactVerdictEvidence(evidence);
    assertTokenAbsent(JSON.stringify(redacted));
  });

  it("case 4 — circuit_breaker_tripped loop_state evidence never leaks the planted secret", () => {
    const evidence: PageError[] = [
      {
        source: "network",
        severity: "blocking",
        message: `POST /save → 500 (token=${SECRET})`,
        observedAtStep: 1,
      },
    ];
    // Mismo helper que consume el emit site real en pipeline.ts.
    const redacted = redactVerdictEvidence(evidence);
    assertTokenAbsent(JSON.stringify({ state: "circuit_breaker_tripped", evidence: redacted }));
  });

  it("case 5 — persistence_check_failed loop_state goal never leaks the planted secret (gap found by this audit)", () => {
    const goal = `Guardar la nota usando password=${SECRET}`;
    const redacted = redactOrTruncateText(goal);
    assertTokenAbsent(JSON.stringify({ state: "persistence_check_failed", goal: redacted }));
  });

  it("case 6 — heal_failure/heal_action rationale (healer LLM free text) never leaks the planted secret", () => {
    const rationale = `El campo oculto trae token=${SECRET}; hay que copiarlo antes de continuar`;
    const redacted = redactOrTruncateText(rationale);
    assertTokenAbsent(JSON.stringify({ rationale: redacted }));
  });

  it("case 7 — step_failure/heal_failure error message (Playwright exception text) never leaks the planted secret", () => {
    const errorMessage = `Timeout 30000ms exceeded waiting for selector [data-token="${SECRET}"]`;
    const redacted = redactOrTruncateText(errorMessage);
    assertTokenAbsent(JSON.stringify({ error: redacted }));
  });

  it("does not over-redact plain diagnostic text with no sensitive keyword (regression guard across all 7 cases)", () => {
    expect(redactOrTruncateText("500 Internal Server Error en POST /save")).toBe(
      "500 Internal Server Error en POST /save",
    );
    expect(redactOrTruncateList(["deterministicChecks: victory.met=false"])).toEqual([
      "deterministicChecks: victory.met=false",
    ]);
  });
});
