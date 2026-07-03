/**
 * Detector de estancamiento — integración con el pipeline real (Capa 2, spec §4.2c).
 *
 * `detectStall` (función pura) ya se prueba en `victory-verification.test.ts`.
 * Este archivo verifica que el loop de `runAssistedFlow` REALMENTE cuenta diffs
 * de snapshot triviales consecutivos y corta con `stopReason:
 * "needs-judge:stalled"` al llegar al umbral (default N=3), en vez de agotar
 * el presupuesto del run sin cortar antes.
 */
import { describe, expect, it } from "vitest";
import { runAssistedFlow, type AssistedDeps } from "../pipeline.js";
import { startFixtureApp, type FixtureApp } from "../../../test-fixtures/app.js";

const noopStrategist: AssistedDeps["strategist"] = async () => {
  throw new Error("full-plan flow: el strategist no debería invocarse");
};
const noopHealer: AssistedDeps["healer"] = async () => ({ steps: [] });

describe("stall detector wired into runAssistedFlow (spec §4.2c)", () => {
  it(
    "corta con stopReason=needs-judge:stalled tras N pasos consecutivos sin mutación de DOM",
    async () => {
      const app: FixtureApp = await startFixtureApp();
      try {
        // waitForSelector sobre elementos siempre visibles en la home: no mutan
        // el DOM, así que cada paso exitoso deja el snapshot idéntico al previo.
        const result = await runAssistedFlow(
          {
            baseUrl: app.baseUrl,
            steps: [
              { action: "goto", url: "/" },
              { action: "waitForSelector", selector: "h1" },
              { action: "waitForSelector", selector: '[data-testid="note-title-input"]' },
              { action: "waitForSelector", selector: '[data-testid="save-note-button"]' },
              { action: "waitForSelector", selector: "form" },
            ],
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
          { strategist: noopStrategist, healer: noopHealer },
        );

        expect(result.ok).toBe(false);
        expect(result.stopReason).toBe("needs-judge:stalled");
        // Corte determinista temprano: no debe agotar los 30s de maxLoopMs.
        expect(result.durationMs).toBeLessThan(15_000);
      } finally {
        await app.close();
      }
    },
    30_000,
  );
});
