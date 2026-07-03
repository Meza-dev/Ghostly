/**
 * Benchmark de fiabilidad (spec §7, Fase 0, tarea 0.3 — evoluciona con cada fase).
 *
 * Corre los 10 flujos etiquetados contra la app fixture usando el pipeline
 * asistido REAL. Capas 2a (circuit breaker) y 2b (victoria verificada +
 * double-check de persistencia + estancamiento) ya están implementadas.
 *
 * Capa 3 (Fase 3a, GHOST-29): el CONTRATO del juez, el dossier builder y el
 * WIRING de los 5 triggers en `pipeline.ts` ya están implementados y probados
 * acá — pero el juez inyectado en este archivo es un ORÁCULO DE TEST
 * determinista (`testOracleJudge` en `benchmark-runner.ts`), NO un LLM real.
 * Clasifica solo a partir de las señales que el dossier ya trae
 * (deterministicChecks + pageErrors + patrones de error de red), sin ningún
 * modelo. El 10/10 que este archivo alcanza mide que el WIRING resuelve
 * correctamente los 5 triggers hacia el veredicto esperado — NO mide
 * precisión de clasificación de un juez real, que es explícitamente Fase
 * 3b/GHOST-30 (factory `createJudge` del lado API + prompt de sistema).
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

  it(
    "distingue fail-test-broken de fail-agent-lost vía el trigger healing-exhausted/victory-candidate del juez " +
      "(AC4, Fase 3a — wiring probado con el oráculo de test, NO con un juez LLM real; ver GHOST-30)",
    async () => {
      const report = await runReliabilityBenchmark(
        BENCHMARK_FLOWS.filter(
          (f) =>
            f.id === "test-broken-wrong-victory-selector" ||
            f.id === "agent-lost-selector-typo-recoverable-path-exists",
        ),
      );
      expect(report.results).toHaveLength(2);
      const testBroken = report.results.find((r) => r.flow.id === "test-broken-wrong-victory-selector");
      const agentLost = report.results.find(
        (r) => r.flow.id === "agent-lost-selector-typo-recoverable-path-exists",
      );
      expect(testBroken!.observedVerdict).toBe("fail-test-broken");
      expect(agentLost!.observedVerdict).toBe("fail-agent-lost");
      // Antes de este slice ambos colapsaban en un fail sin clasificar
      // (`unclassified`) — ya no colapsan: son veredictos DISTINTOS.
      expect(testBroken!.observedVerdict).not.toBe(agentLost!.observedVerdict);
      expect(testBroken!.runResult.judgeEvents?.length ?? 0).toBeGreaterThan(0);
      expect(agentLost!.runResult.judgeEvents?.length ?? 0).toBeGreaterThan(0);
    },
    30_000,
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
    "RED baseline: el benchmark de Fase 3a corre en full-plan con un strategist noop — no puede probar que " +
      "un agente real SIN el paso explícito de cierre del modal se recupere usando el hint del juez (requiere " +
      "un strategist real que consuma StrategistContext.judgeHint, Fase 3b/GHOST-30)",
  );

  it(
    "cero falsos éxitos (spec AC1/AC3 — invariante duro desde Fase 2b, se mantiene con el juez wireado)",
    async () => {
      const report = await runReliabilityBenchmark();
      // Mentir que algo tuvo éxito es el peor defecto posible (spec §1). Este
      // test congela ese invariante como regresión — si vuelve a subir de 0,
      // algo rompió el circuit breaker, el double-check de persistencia, o
      // (desde esta fase) el sesgo anti-falso-éxito del juez/oráculo.
      expect(report.falseSuccessCount).toBe(0);
    },
    120_000,
  );

  it(
    "meta objetivo del benchmark (spec AC1): 10/10 veredictos veraces con el WIRING de la Capa 3 + oráculo de " +
      "test determinista (Fase 3a) — esto mide correctitud del wiring, NO precisión de un juez LLM real, que " +
      "es explícitamente Fase 3b/GHOST-30 y se valida contra el mismo ground truth de flows.ts",
    async () => {
      const report = await runReliabilityBenchmark();
      // eslint-disable-next-line no-console
      console.log(formatBenchmarkReport(report));
      expect(report.truthfulCount).toBe(report.total);
      expect(report.falseSuccessCount).toBe(0);
    },
    120_000,
  );
});
