/**
 * Benchmark de fiabilidad — baseline RED (spec §7, Fase 0, tarea 0.3).
 *
 * Corre los 10 flujos etiquetados contra la app fixture usando el pipeline
 * asistido REAL de hoy (sin Capa 2/Capa 3 — esas llegan en fases posteriores).
 * El objetivo de este test es DOCUMENTAR el comportamiento actual, no hacerlo
 * pasar a la fuerza: los casos que hoy fallan (falso éxito, sin distinguir
 * responsables) quedan marcados explícitamente como baseline RED con
 * `todo`/notas — se promueven a aserciones estrictas a medida que las fases
 * 1-3 del roadmap (observer, reglas duras, juez) los resuelvan.
 *
 * Ejecutar: `pnpm --filter @ghostly-io/runner test reliability-benchmark`
 */
import { describe, expect, it } from "vitest";
import { BENCHMARK_FLOWS } from "../../../test-fixtures/flows.js";
import { formatBenchmarkReport, runReliabilityBenchmark } from "../../../test-fixtures/benchmark-runner.js";

describe("reliability benchmark (RED baseline — pipeline sin Capa 2/3)", () => {
  it("tiene 10 flujos etiquetados cubriendo los 6 veredictos de la taxonomía", () => {
    expect(BENCHMARK_FLOWS).toHaveLength(10);
    const verdicts = new Set(BENCHMARK_FLOWS.map((f) => f.expectedVerdict));
    expect(verdicts).toEqual(
      new Set([
        "success",
        "fail-app-bug",
        "fail-test-broken",
        "fail-agent-lost",
        "inconclusive-environment",
        "inconclusive",
      ]),
    );
  });

  it(
    "corre el benchmark completo y reporta el estado actual (no debe tirar excepciones)",
    async () => {
      const report = await runReliabilityBenchmark();
      // eslint-disable-next-line no-console
      console.log(formatBenchmarkReport(report));

      expect(report.total).toBe(10);
      expect(report.results).toHaveLength(10);
      // El reporte siempre debe producirse, incluso cuando el pipeline actual
      // clasifica mal — este test documenta el baseline, no lo esconde.
    },
    120_000,
  );

  it.todo(
    "RED baseline: hoy el pipeline reporta 'Nota efímera' como éxito falso en non-persisting-save (AC1/AC3 — se cierra en Fase 2b)",
  );

  it.todo(
    "RED baseline: hoy el pipeline no distingue fail-test-broken de fail-agent-lost — ambos colapsan en un fail genérico (AC4 — se cierra en Fase 3a/3b, requiere el juez)",
  );

  it(
    "500 en /save corta el run de inmediato con verdict=fail-app-bug y evidencia (AC2, Fase 2a — circuit breaker)",
    async () => {
      const report = await runReliabilityBenchmark(
        BENCHMARK_FLOWS.filter((f) => f.id === "500-on-save-cuts-run"),
      );
      const [result] = report.results;
      expect(result).toBeDefined();
      expect(result!.observedVerdict).toBe("fail-app-bug");
      expect(result!.truthful).toBe(true);
      expect(result!.falseSuccess).toBe(false);
      // No consultó al LLM (deps.strategist/healer del benchmark son noop y no
      // deberían invocarse en full-plan) y no agotó el presupuesto del flujo
      // (maxLoopMs=30_000): el corte determinista debe ser mucho más rápido.
      expect(result!.runResult.durationMs).toBeLessThan(15_000);
      expect(result!.runResult.stopReason).toBe("blocked-by-app-error");
      expect(result!.runResult.verdictEvidence?.length ?? 0).toBeGreaterThan(0);
      expect(result!.runResult.verdictEvidence?.[0]?.severity).toBe("blocking");
    },
    30_000,
  );

  it.todo(
    "RED baseline: hoy el modal bloqueante depende de que el paso explícito de cierre esté en el plan; sin Capa 3 (juez con hint) un agente real sin ese paso queda perdido (AC4 — se cierra en Fase 3a/3b)",
  );

  it("meta objetivo del benchmark (spec AC1): 10/10 veredictos veraces y cero falsos éxitos — aún NO se cumple hoy", async () => {
    const report = await runReliabilityBenchmark();
    // Esta aserción documenta la meta final de la versión; hoy es baseline RED
    // (se espera que falle) y se promueve a expectativa estricta cuando las
    // Fases 1-3 del roadmap estén implementadas (ver Fase 3b, tarea 3b.8).
    const isFullyTruthfulYet = report.truthfulCount === report.total && report.falseSuccessCount === 0;
    expect(isFullyTruthfulYet).toBe(false);
  }, 120_000);
});
