/**
 * Detector de estancamiento — integración con el pipeline real (Capa 2, spec §4.2c)
 * y con el trigger `stalled` del juez (Capa 3, spec §4.3, Fase 3a).
 *
 * `detectStall` (función pura) ya se prueba en `victory-verification.test.ts`.
 * Este archivo verifica que el loop de `runAssistedFlow` REALMENTE cuenta diffs
 * de snapshot triviales consecutivos, invoca `deps.judge` al llegar al umbral
 * (default N=3) con `reason: "stalled"`, y aplica el veredicto — en vez de
 * agotar el presupuesto del run sin cortar antes.
 */
import { describe, expect, it } from "vitest";
import { runAssistedFlow, type AssistedDeps } from "../pipeline.js";
import type { JudgeFn } from "../types.js";
import { startFixtureApp, type FixtureApp } from "../../../test-fixtures/app.js";

const noopStrategist: AssistedDeps["strategist"] = async () => {
  throw new Error("full-plan flow: el strategist no debería invocarse");
};
const noopHealer: AssistedDeps["healer"] = async () => ({ steps: [] });

/** Juez de test determinista: siempre falla como "el agente se perdió" (nunca invocado por un LLM real). */
const terminalStubJudge: JudgeFn = async (dossier) => ({
  verdict: "fail-agent-lost",
  confidence: "medium",
  reasoning: `Test oracle: motivo=${dossier.reason}, sin progreso tras ${dossier.recentActions.length} acciones.`,
  evidence: [dossier.snapshotDiff],
});

const STALL_FLOW_STEPS = [
  { action: "goto" as const, url: "/" },
  { action: "waitForSelector" as const, selector: "h1" },
  { action: "waitForSelector" as const, selector: '[data-testid="note-title-input"]' },
  { action: "waitForSelector" as const, selector: '[data-testid="save-note-button"]' },
  { action: "waitForSelector" as const, selector: "form" },
];

describe("stall detector wired into runAssistedFlow + judge (spec §4.2c, §4.3)", () => {
  it(
    "invoca al juez con reason=stalled tras N pasos consecutivos sin mutación de DOM y aplica su veredicto terminal",
    async () => {
      const app: FixtureApp = await startFixtureApp();
      try {
        // waitForSelector sobre elementos siempre visibles en la home: no mutan
        // el DOM, así que cada paso exitoso deja el snapshot idéntico al previo.
        const result = await runAssistedFlow(
          {
            baseUrl: app.baseUrl,
            steps: STALL_FLOW_STEPS,
            headless: true,
            captureA11yAfterEachStep: false,
            captureScreenshotAfterEachStep: false,
            recordVideoOnFailure: false,
            artifactsDir: "artifacts",
            defaultTimeoutMs: 8_000,
            assist: {
              v2: true,
              isFullPlan: true,
              maxHorizons: 1,
              stepsPerHorizon: 10,
              maxLoopMs: 30_000,
              maxHealingAttemptsPerStep: 0,
              goal: "Explorar la página sin hacer cambios",
              // Sin victory configurada: aislamos el comportamiento del stall
              // detector del double-check de persistencia (goal no la implica).
            },
          },
          { strategist: noopStrategist, healer: noopHealer, judge: terminalStubJudge },
        );

        expect(result.ok).toBe(false);
        expect(result.stopReason).toBe("judge-terminal-verdict");
        expect(result.verdict).toBe("fail-agent-lost");
        expect(result.judgeEvents).toHaveLength(1);
        expect(result.judgeEvents?.[0]?.reason).toBe("stalled");
        // Corte determinista temprano: no debe agotar los 30s de maxLoopMs.
        expect(result.durationMs).toBeLessThan(15_000);
      } finally {
        await app.close();
      }
    },
    30_000,
  );

  it(
    "un veredicto continue del juez limpia el contador de estancamiento y deja seguir el run (no corta el loop)",
    async () => {
      const app: FixtureApp = await startFixtureApp();
      let judgeCalls = 0;
      const continueThenNothingJudge: JudgeFn = async () => {
        judgeCalls++;
        return {
          verdict: "continue",
          confidence: "medium",
          reasoning: "Test oracle: da una oportunidad más antes de rendirse.",
          evidence: [],
          hint: "probá esperar un poco más antes de declarar estancamiento",
        };
      };
      try {
        const result = await runAssistedFlow(
          {
            baseUrl: app.baseUrl,
            steps: STALL_FLOW_STEPS,
            headless: true,
            captureA11yAfterEachStep: false,
            captureScreenshotAfterEachStep: false,
            recordVideoOnFailure: false,
            artifactsDir: "artifacts",
            defaultTimeoutMs: 8_000,
            assist: {
              v2: true,
              isFullPlan: true,
              maxHorizons: 1,
              stepsPerHorizon: 10,
              maxLoopMs: 30_000,
              maxHealingAttemptsPerStep: 0,
              goal: "Explorar la página sin hacer cambios",
            },
          },
          { strategist: noopStrategist, healer: noopHealer, judge: continueThenNothingJudge },
        );

        // El juez dijo "continue" para el único trigger de stall que alcanza a
        // dispararse dentro del plan de 5 pasos fijo (full-plan, sin más pasos
        // tras el estancamiento) — el run sigue vivo y termina por otra vía
        // (plan agotado), no por el stall en sí.
        expect(judgeCalls).toBeGreaterThan(0);
        expect(result.stopReason).not.toBe("judge-terminal-verdict");
      } finally {
        await app.close();
      }
    },
    30_000,
  );
});
