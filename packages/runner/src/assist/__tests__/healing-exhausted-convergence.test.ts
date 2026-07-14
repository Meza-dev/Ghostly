/**
 * FIX #6 — el bucle heal -> replan tras agotar la curación no converge.
 *
 * Reproducción del incidente F1: tras un paso que falla y que el healer no
 * puede recuperar, el strategist re-planifica OTRO paso condenado sobre el
 * MISMO objetivo (p. ej. `waitForSelector` de un elemento que nunca aparece).
 * El camino C del `catch` (`replannedFromError` -> `break`) continúa con los
 * pasos re-planificados SIN invocar al juez, así que el trigger
 * `healing-exhausted` queda STARVED: el ciclo heal -> replan -> continue ->
 * fail se repite horizonte tras horizonte hasta que `maxHorizons`/`maxLoopMs`
 * fuerza `budget-exhausted` (~5 min en producción) y suele emitir
 * `fail-agent-lost` sobre lo que era un tropiezo recuperable.
 *
 * Contrato correcto (una sola oportunidad de replan por paso, luego el juez):
 * la PRIMERA vez que un paso agota la curación se permite el replan-recovery
 * existente; la SEGUNDA vez que el MISMO paso (por `stepKey`) vuelve a agotar,
 * se deja de re-planificar y se enruta a `invokeJudge("healing-exhausted")`,
 * que decide el desenlace antes de quemar el presupuesto.
 */
import { describe, expect, it } from "vitest";
import { runAssistedFlow, type AssistedDeps } from "../pipeline.js";
import type { JudgeFn, StrategistFn } from "../types.js";
import type { Step } from "../../schema.js";
import { startFixtureApp, type FixtureApp } from "../../../test-fixtures/app.js";

/** Selector que NUNCA existe en la app fixture — cualquier `waitForSelector` sobre él agota su timeout. */
const DOOMED_STEP: Step = {
  action: "waitForSelector",
  selector: '[data-testid="ghost-nunca-aparece-fix6"]',
  timeoutMs: 400,
};

/** Healer que nunca recupera (no propone pasos) — fuerza `recovered = false`. */
const noopHealer: AssistedDeps["healer"] = async () => ({ steps: [] });

/**
 * "Strategist testarudo": tanto en el plan inicial como en CADA replan devuelve
 * el mismo paso condenado sobre el mismo objetivo, simulando el bucle F1 en el
 * que el strategist insiste con un `waitForSelector` de un campo ausente.
 */
const stubbornStrategist: StrategistFn = async () => ({
  steps: [{ step: DOOMED_STEP }],
  hasMore: false,
});

describe("FIX #6 — el replan tras agotar la curación debe converger al juez, no quemar presupuesto", () => {
  it("enruta a healing-exhausted en la 2da exhaustion del MISMO paso, antes de budget-exhausted", async () => {
    const app: FixtureApp = await startFixtureApp();
    const judgeReasons: string[] = [];
    try {
      const countingJudge: JudgeFn = async (dossier) => {
        judgeReasons.push(dossier.reason);
        // El juez corta el run con un veredicto terminal ni bien lo consultan,
        // así podemos afirmar que terminó PRONTO (por el juez) y no por budget.
        return {
          verdict: "fail-agent-lost",
          confidence: "high",
          reasoning: `Test double: veredicto terminal para el trigger "${dossier.reason}".`,
          evidence: ["snapshot no muestra el objetivo esperado"],
        };
      };

      const result = await runAssistedFlow(
        {
          baseUrl: app.baseUrl,
          steps: [{ action: "goto", url: "/" }],
          headless: true,
          captureA11yAfterEachStep: false,
          captureScreenshotAfterEachStep: false,
          recordVideoOnFailure: false,
          artifactsDir: "artifacts",
          defaultTimeoutMs: 400,
          assist: {
            v2: true,
            isFullPlan: false,
            maxHorizons: 4,
            stepsPerHorizon: 5,
            maxLoopMs: 25_000,
            maxHealingAttemptsPerStep: 1,
            goal: "Esperar un campo que nunca aparece (reproducción F1)",
            // Victory que jamás se cumple: en el código con bug, el desenlace
            // solo llega por budget-exhausted al agotar maxHorizons.
            victory: { textIncludes: ["ESTE-TEXTO-NUNCA-APARECE-FIX6"], revalidate: false },
          },
        },
        {
          strategist: stubbornStrategist,
          healer: noopHealer,
          judge: countingJudge,
        },
      );

      // GREEN: el juez fue consultado por `healing-exhausted` (2da exhaustion
      // del mismo paso) y NUNCA se llegó a `budget-exhausted`.
      expect(judgeReasons).toContain("healing-exhausted");
      expect(judgeReasons).not.toContain("budget-exhausted");
      // El desenlace lo dictó el juez, no el agotamiento de presupuesto.
      expect(result.verdict).toBe("fail-agent-lost");
    } finally {
      await app.close();
    }
  }, 60_000);
});
