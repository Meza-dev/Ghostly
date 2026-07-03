/**
 * Bug encontrado durante GHOST-30 (Fase 3b): `applyTerminalJudgeVerdict`
 * marcaba SIEMPRE `runOk = false`, incluso cuando el juez devolvía
 * `verdict: "success"` (legítimo — spec §4.3: el juez PUEDE declarar éxito
 * si cita evidencia que lo pruebe, típicamente en el trigger
 * `victory-candidate` sin condición de victoria configurada o con condición
 * ambigua). Esto rompía dos cosas: (a) `result.ok` quedaba en `false` pese a
 * `result.verdict === "success"` — contradictorio; (b) en la API, el guardia
 * de memoria (spec §6, `run.ts`) usaba `status === "pass"` (derivado de
 * `result.ok`) como única fuente de verdad, así que un éxito legítimo vía
 * juez JAMÁS podía persistir memoria — y peor, un futuro guardia que
 * chequeara SOLO `verdict === "success"` sin mirar `ok` habría podido
 * persistir memoria de un run marcado `ok: false`, lo cual es igual de
 * inconsistente.
 *
 * Este test fija el contrato correcto: `verdict === "success"` (venga de
 * dónde venga: circuit breaker, victoria determinista, o el juez) SIEMPRE
 * implica `result.ok === true`.
 */
import { describe, expect, it } from "vitest";
import { runAssistedFlow, type AssistedDeps } from "../pipeline.js";
import type { JudgeFn } from "../types.js";
import { startFixtureApp, type FixtureApp } from "../../../test-fixtures/app.js";

const noopHealer: AssistedDeps["healer"] = async () => ({ steps: [] });

describe("a judge verdict of 'success' must produce result.ok === true (bug fixed during GHOST-30)", () => {
  it("marks the run ok when the judge legitimately declares success at a victory-candidate trigger", async () => {
    const app: FixtureApp = await startFixtureApp();
    try {
      const successJudge: JudgeFn = async (dossier) => ({
        verdict: "success",
        confidence: "high",
        reasoning: `Test double: el juez cita evidencia y declara éxito para el trigger "${dossier.reason}".`,
        evidence: ["snapshot muestra el estado esperado"],
      });

      const result = await runAssistedFlow(
        {
          baseUrl: app.baseUrl,
          steps: [
            { action: "goto", url: "/" },
            { action: "fill", selector: '[data-testid="note-title-input"]', value: "Juez dice éxito" },
            { action: "click", selector: '[data-testid="save-note-button"]' },
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
            goal: "Crear una nota con título 'Juez dice éxito'",
            // Sin victory configurada: el desenlace SIEMPRE lo decide el
            // juez al agotar el plan (trigger victory-candidate).
          },
        },
        {
          strategist: async () => ({ steps: [], hasMore: false }),
          healer: noopHealer,
          judge: successJudge,
        },
      );

      expect(result.verdict).toBe("success");
      expect(result.ok).toBe(true);
    } finally {
      await app.close();
    }
  }, 30_000);
});
