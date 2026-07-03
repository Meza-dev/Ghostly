/**
 * Benchmark de fiabilidad (spec §7, Fase 0, tarea 0.3 — evoluciona con cada fase).
 *
 * Corre los 10 flujos etiquetados contra la app fixture usando el pipeline
 * asistido REAL. Capas 2a (circuit breaker) y 2b (victoria verificada +
 * double-check de persistencia + estancamiento) ya están implementadas;
 * Capa 3 (el juez) todavía no — los 3 flujos de zona gris que dependen de él
 * quedan como `todo`/aserciones laxas explícitas hasta Fase 3a/3b. El
 * objetivo de este test es DOCUMENTAR el comportamiento real, no hacerlo
 * pasar a la fuerza.
 *
 * Ejecutar: `pnpm --filter @ghostly-io/runner test reliability-benchmark`
 */
import { describe, expect, it } from "vitest";
import { BENCHMARK_FLOWS } from "../../../test-fixtures/flows.js";
import { formatBenchmarkReport, runReliabilityBenchmark } from "../../../test-fixtures/benchmark-runner.js";

describe("reliability benchmark (pipeline con Capa 2 completa — Capa 3/juez pendiente)", () => {
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

  it(
    "guardado que no persiste tras recargar NO produce success (AC3, Fase 2b — double-check de persistencia)",
    async () => {
      const report = await runReliabilityBenchmark(
        BENCHMARK_FLOWS.filter((f) => f.id === "non-persisting-save-no-false-success"),
      );
      const [result] = report.results;
      expect(result).toBeDefined();
      expect(result!.observedVerdict).toBe("fail-app-bug");
      expect(result!.truthful).toBe(true);
      expect(result!.falseSuccess).toBe(false);
      expect(result!.runResult.verdict).toBe("fail-app-bug");
      expect(result!.runResult.verdictReason).toMatch(/persistencia/i);
    },
    30_000,
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

  it(
    "cero falsos éxitos (spec AC1/AC3 — invariante duro desde Fase 2b, no espera al juez)",
    async () => {
      const report = await runReliabilityBenchmark();
      // A diferencia del truthfulCount total (que sí depende del juez para los
      // 3 flujos de zona gris restantes), "cero falsos éxitos" es una garantía
      // que la Capa 2 determinista debe sostener SOLA desde esta fase: mentir
      // que algo tuvo éxito es el peor defecto posible (spec §1). Este test
      // congela ese invariante como regresión — si vuelve a subir de 0, algo
      // rompió el circuit breaker o el double-check de persistencia.
      expect(report.falseSuccessCount).toBe(0);
    },
    120_000,
  );

  it("meta objetivo del benchmark (spec AC1): 10/10 veredictos veraces — aún NO se cumple hoy (requiere el juez, Fase 3a/3b)", async () => {
    const report = await runReliabilityBenchmark();
    // Esta aserción documenta la meta final de la versión; hoy es baseline RED
    // para el conteo TOTAL (3 flujos de zona gris siguen sin el juez) y se
    // promueve a expectativa estricta cuando las Fases 3a/3b estén implementadas
    // (ver Fase 3b, tarea 3b.8). El invariante de cero falsos éxitos YA se
    // sostiene desde esta fase (ver test anterior).
    const isFullyTruthfulYet = report.truthfulCount === report.total;
    expect(isFullyTruthfulYet).toBe(false);
  }, 120_000);
});
