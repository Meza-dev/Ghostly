/**
 * W10 — el dossier del juez debe poder reportar `outcome: "healed"` en
 * `recentActions` (spec §4.3, `buildJudgeDossier`/`toRecentAction`, ver
 * `judge.ts`). Antes de esta corrección, `history` en `pipeline.ts` nunca
 * marcaba `healed: true` tras un heal exitoso, así que ese branch de
 * `toRecentAction` era código muerto en la práctica — el juez siempre veía
 * pasos curados por el healer como `ok` normal, indistinguibles de un paso
 * que nunca falló.
 *
 * Este test ejercita el camino real: un paso falla por un selector con typo,
 * el healer propone directamente el paso corregido y este EJECUTA con éxito
 * dentro del ciclo de heal — y verifica que ESE paso queda marcado como
 * `healed` en el dossier que llega al juez en el siguiente trigger
 * (`victory-candidate`, sin condición de victoria configurada a propósito
 * para forzar la invocación). El otro branch corregido en el mismo fix
 * (reintento del paso ORIGINAL tras un heal que no lo reemplaza) comparte la
 * misma corrección y queda cubierto por revisión de código — ambos pushes
 * en `pipeline.ts` usan el mismo patrón `{ ..., healed: true }`.
 */
import { describe, expect, it } from "vitest";
import { runAssistedFlow, type AssistedDeps } from "../pipeline.js";
import type { JudgeDossier, JudgeFn, JudgeVerdict } from "../types.js";
import { startFixtureApp, type FixtureApp } from "../../../test-fixtures/app.js";

const capturingDossiers: JudgeDossier[] = [];

const inconclusiveJudge: JudgeFn = async (dossier): Promise<JudgeVerdict> => {
  capturingDossiers.push(dossier);
  return {
    verdict: "inconclusive",
    confidence: "low",
    reasoning: "Test double: siempre inconclusive, solo capturamos el dossier.",
    evidence: [],
  };
};

describe("pipeline history marks healed steps so the judge dossier can report outcome='healed' (W10)", () => {
  it("marks the retried-after-heal step as healed in the dossier sent to the judge", async () => {
    capturingDossiers.length = 0;
    const app: FixtureApp = await startFixtureApp();
    try {
      // Plan con un selector con typo a propósito: falla, dispara al healer.
      // El healer propone directamente el `fill` con el selector correcto —
      // ese paso EJECUTA con éxito dentro del ciclo de heal (branch
      // `history.push({ step: healStep, ok: true, healed: true })`,
      // pipeline.ts ~línea 2484). Como el healer reemplaza el selector (no
      // es un no-op), `hasEquivalentReplacementStep` hace que el runner NO
      // reintente el paso original — el propio paso del healer es el que
      // queda marcado `healed` en el historial que llega al juez.
      const healerFixesSelector: AssistedDeps["healer"] = async () => ({
        steps: [{ action: "fill", selector: '[data-testid="note-title-input"]', value: "W10 healed test" }],
        rationale: "El selector del plan tenía un typo; el mapa fresco muestra el input real.",
      });

      const result = await runAssistedFlow(
        {
          baseUrl: app.baseUrl,
          steps: [
            { action: "goto", url: "/" },
            { action: "fill", selector: '[data-testid="note-title-input-TYPO"]', value: "W10 healed test" },
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
            maxHealingAttemptsPerStep: 1,
            goal: "Crear una nota con título 'W10 healed test'",
            // Sin condición de victoria configurada: al agotar el plan de
            // entrada, el desenlace SIEMPRE lo decide el juez (spec §4.2b,
            // trigger victory-candidate) — esto fuerza la invocación para
            // poder inspeccionar el dossier con el healed step ya en el
            // historial.
          },
        },
        {
          strategist: async () => ({ steps: [], hasMore: false }),
          healer: healerFixesSelector,
          judge: inconclusiveJudge,
        },
      );

      expect(result.judgeEvents?.length ?? 0).toBeGreaterThan(0);
      expect(capturingDossiers.length).toBeGreaterThan(0);
      const dossier = capturingDossiers[0]!;
      const healedAction = dossier.recentActions.find((a) => a.outcome === "healed");
      expect(healedAction).toBeDefined();
      expect(healedAction!.step).toContain("note-title-input");
      // El runner SIEMPRE captura el buffer del screenshot al invocar al juez
      // (decisión de ENVIARLO o no al LLM es 100% responsabilidad de la API,
      // GHOST-30, según capacidad del provider — spec §4.3 "híbrido").
      expect(dossier.screenshot).toBeInstanceOf(Buffer);
      expect(dossier.screenshot!.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  }, 30_000);
});
