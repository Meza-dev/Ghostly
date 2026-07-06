/**
 * Benchmark de fiabilidad (spec §7, Fase 0, tarea 0.3 — evoluciona con cada fase).
 *
 * Corre los 13 flujos etiquetados (10 originales + 3 de cobertura del healer,
 * HEALER-1) contra la app fixture usando el pipeline asistido REAL. Capas 2a
 * (circuit breaker) y 2b (victoria verificada + double-check de persistencia
 * + estancamiento) ya están implementadas.
 *
 * Capa 3 (Fase 3a, GHOST-29): el CONTRATO del juez, el dossier builder y el
 * WIRING de los 5 triggers en `pipeline.ts` ya están implementados y probados
 * acá — pero el juez inyectado en este archivo es un ORÁCULO DE TEST
 * determinista (`testOracleJudge` en `benchmark-runner.ts`), NO un LLM real.
 * Clasifica solo a partir de las señales que el dossier ya trae
 * (deterministicChecks + pageErrors + patrones de error de red), sin ningún
 * modelo. El 10/10 (ahora 13/13) que este archivo alcanza mide que el WIRING
 * resuelve correctamente los 5 triggers hacia el veredicto esperado — NO mide
 * precisión de clasificación de un juez real, que es explícitamente Fase
 * 3b/GHOST-30 (factory `createJudge` del lado API + prompt de sistema).
 *
 * HEALER-1 (esta fase): añade `testOracleHealer`, un doble determinista
 * análogo que reemplaza a `noopHealer` para probar catch→heal→retry en 3
 * escenarios reales (selector renombrado, modal/overlay bloqueando, selector
 * ambiguo) — ver `benchmark-runner.ts` para el detalle de las reglas.
 *
 * Ejecutar: `pnpm --filter @ghostly-io/runner test reliability-benchmark`
 */
import { describe, expect, it } from "vitest";
import { BENCHMARK_FLOWS } from "../../../test-fixtures/flows.js";
import { formatBenchmarkReport, runReliabilityBenchmark } from "../../../test-fixtures/benchmark-runner.js";

describe("reliability benchmark (pipeline con Capa 2 completa — Capa 3/juez pendiente)", () => {
  it("tiene 14 flujos etiquetados (10 originales + 3 de cobertura del healer HEALER-1 + 1 de HEALER-2) cubriendo los 6 veredictos de la taxonomía", () => {
    expect(BENCHMARK_FLOWS).toHaveLength(14);
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

      expect(report.total).toBe(14);
      expect(report.results).toHaveLength(14);
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

  describe("cobertura del healer (HEALER-1 — doble determinista testOracleHealer, safety net)", () => {
    it(
      "selector-renamed-healer-recovers: el healer detecta el testid renombrado y recupera el guardado " +
        "(R2/AC1 — prueba heal_start+heal_success, no solo el veredicto final)",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "selector-renamed-healer-recovers"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("success");
        expect(result!.falseSuccess).toBe(false);
        expect(result!.healInvocations).toBeGreaterThanOrEqual(1);
        const healSuccessEvents = result!.runResult.events.filter((e) => e.type === "heal_success");
        expect(healSuccessEvents.length).toBeGreaterThanOrEqual(1);
      },
      30_000,
    );

    it(
      "modal-overlay-needs-heal-dismiss: el healer detecta el overlay bloqueando y antepone el dismiss " +
        "(R2/AC2 — prueba heal_start+heal_success, no solo el veredicto final)",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "modal-overlay-needs-heal-dismiss"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("success");
        expect(result!.falseSuccess).toBe(false);
        expect(result!.healInvocations).toBeGreaterThanOrEqual(1);
        const healSuccessEvents = result!.runResult.events.filter((e) => e.type === "heal_success");
        expect(healSuccessEvents.length).toBeGreaterThanOrEqual(1);
      },
      30_000,
    );

    it(
      "ambiguous-duplicate-selector: el healer desambigua por data-testid ante una violación de strict-mode " +
        "(R2/AC3 — prueba heal_start+heal_success, no solo el veredicto final)",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "ambiguous-duplicate-selector"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("success");
        expect(result!.falseSuccess).toBe(false);
        expect(result!.healInvocations).toBeGreaterThanOrEqual(1);
        const healSuccessEvents = result!.runResult.events.filter((e) => e.type === "heal_success");
        expect(healSuccessEvents.length).toBeGreaterThanOrEqual(1);
      },
      30_000,
    );

    it("los 10 flujos existentes nunca invocan al healer (maxHealingAttemptsPerStep=0 los mantiene inertes)", async () => {
      const report = await runReliabilityBenchmark(BENCHMARK_FLOWS);
      const existingResults = report.results.filter(
        (r) =>
          r.flow.id !== "selector-renamed-healer-recovers" &&
          r.flow.id !== "modal-overlay-needs-heal-dismiss" &&
          r.flow.id !== "ambiguous-duplicate-selector" &&
          r.flow.id !== "blocking-error-healer-abstains",
      );
      expect(existingResults).toHaveLength(10);
      for (const r of existingResults) {
        expect(r.healInvocations).toBe(0);
      }
    }, 120_000);
  });

  describe("cesión determinista del healer ante error bloqueante (HEALER-2 / H1)", () => {
    it(
      "blocking-error-healer-abstains: el healer está cableado (maxHealingAttemptsPerStep=1) pero cede al " +
        "juez sin gastar intentos ante evidencia de error bloqueante correlacionado al paso fallido",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "blocking-error-healer-abstains"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("fail-app-bug");
        expect(result!.truthful).toBe(true);
        expect(result!.falseSuccess).toBe(false);
        expect(result!.healInvocations).toBe(0);
        const abstainEvents = result!.runResult.events.filter(
          (e) => e.type === "heal_failure" && e.payload?.reason === "blocking-error-cede-to-judge",
        );
        expect(abstainEvents.length).toBeGreaterThanOrEqual(1);
      },
      15_000,
    );
  });

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
    "meta objetivo del benchmark (spec AC1): 13/13 veredictos veraces (10 originales + 3 de cobertura del " +
      "healer, HEALER-1) con el WIRING de la Capa 3 + oráculo de test determinista (Fase 3a) — esto mide " +
      "correctitud del wiring, NO precisión de un juez LLM real, que es explícitamente Fase 3b/GHOST-30 y se " +
      "valida contra el mismo ground truth de flows.ts",
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
