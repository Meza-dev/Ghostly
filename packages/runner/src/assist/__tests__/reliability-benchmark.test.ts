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
  it("tiene 18 flujos etiquetados (10 originales + 3 de cobertura del healer HEALER-1 + 1 de HEALER-2 + 1 de cobertura genérica de alcance de modal + 1 de plan-pruning genérico HEALER-4 + 2 de selectOption T1/F1) cubriendo los 6 veredictos de la taxonomía", () => {
    expect(BENCHMARK_FLOWS).toHaveLength(18);
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

      expect(report.total).toBe(18);
      expect(report.results).toHaveLength(18);
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
      // FIX #1: el fail-app-bug ya NO es un hard-map — la persistencia fallida se
      // enruta AL JUEZ (spec §4.2b) con la señal `victory.persistedAfterReload`.
      // La invocación del juez lo prueba (antes de FIX #1 era 0: hard-map directo).
      expect(result!.runResult.judgeEvents?.length ?? 0).toBeGreaterThan(0);
      expect(result!.runResult.judgeEvents?.[0]?.reason).toBe("victory-candidate");
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

  it(
    "victoria determinista limpia (victory-met, ok=true) fija verdict=success — spec §5 mapea " +
      "'victoria verificada limpia → success' directo (FIX #3)",
    async () => {
      const report = await runReliabilityBenchmark(
        BENCHMARK_FLOWS.filter((f) => f.id === "happy-path-create-note"),
      );
      const [result] = report.results;
      expect(result).toBeDefined();
      expect(result!.runResult.ok).toBe(true);
      expect(result!.runResult.stopReason).toBe("victory-met");
      // El desenlace es una victoria determinista limpia (sin juez): el verdict
      // NO debe quedar en undefined, debe ser "success" explícito.
      expect(result!.runResult.verdict).toBe("success");
      expect(result!.runResult.verdictReason).toBeTruthy();
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

    it(
      "modal-open-background-click-ignored: el healer detecta el diálogo visible mientras un control de fondo " +
        "queda pointer-intercepted y antepone el dismiss antes de reintentar (cobertura genérica de alcance de " +
        "modal, sin strings de dominio — R-cover/HEALER-3)",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "modal-open-background-click-ignored"),
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

    it("los 11 flujos inertes nunca invocan al healer (maxHealingAttemptsPerStep=0 los mantiene inertes)", async () => {
      const report = await runReliabilityBenchmark(BENCHMARK_FLOWS);
      const existingResults = report.results.filter(
        (r) =>
          r.flow.id !== "selector-renamed-healer-recovers" &&
          r.flow.id !== "modal-overlay-needs-heal-dismiss" &&
          r.flow.id !== "ambiguous-duplicate-selector" &&
          r.flow.id !== "blocking-error-healer-abstains" &&
          r.flow.id !== "modal-open-background-click-ignored" &&
          // HEALER-4 net: usa un strategist real (no noop) para ejercitar
          // shouldDropPlannedStep — no es uno de los flujos full-plan
          // "inertes" que este test cubre. Excluido explícitamente en vez de
          // subir el conteo (design §4 / spec "Full benchmark suite").
          r.flow.id !== "redundant-reopen-dropped-while-dialog-open" &&
          // T1/F1: usa maxHealingAttemptsPerStep=1 a propósito para probar la
          // recuperación del healer (Rule D) — no es inerte.
          r.flow.id !== "select-native-fill-rejected-healer-recovers",
      );
      expect(existingResults).toHaveLength(11);
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

  describe("plan-pruning genérico (HEALER-4 — net previo a la eliminación de matchers de dominio)", () => {
    it(
      "redundant-reopen-dropped-while-dialog-open: el click redundante que duplica el heading del dialog " +
        "visible se DROPPEA vía el mecanismo genérico ya existente (shouldDropRedundantModalOpenClick), y el " +
        "resto del plan (dismiss real + fill + save) igual llega a success — prueba que el path genérico ya " +
        "cubre lo que los matchers de dominio #12/#13 resuelven hoy, ANTES de tocar pipeline.ts",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "redundant-reopen-dropped-while-dialog-open"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("success");
        expect(result!.falseSuccess).toBe(false);
        const dropped =
          result!.runResult.planProgress?.filter(
            (p) => p.status === "dropped" && p.note === "context-drop",
          ) ?? [];
        expect(dropped.length).toBeGreaterThanOrEqual(1);
        expect(
          dropped.some((p) => JSON.stringify(p.step).includes("Confirmar guardado")),
        ).toBe(true);
      },
      30_000,
    );
  });

  describe("selectOption (T1/F1 — obs #426, expand-runner-action-vocabulary)", () => {
    it(
      "select-option-native: selectOption ejecuta sobre un <select> nativo y la categoría elegida persiste " +
        "(ejecución directa, sin healer)",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "select-option-native"),
        );
        const [result] = report.results;
        expect(result).toBeDefined();
        expect(result!.observedVerdict).toBe("success");
        expect(result!.falseSuccess).toBe(false);
        expect(result!.healInvocations).toBe(0);
      },
      30_000,
    );

    it(
      "select-native-fill-rejected-healer-recovers: reproduce el incidente F1 (fill sobre un <select>) — el " +
        "healer lo convierte a selectOption con el mismo valor y el guardado posterior llega a success",
      async () => {
        const report = await runReliabilityBenchmark(
          BENCHMARK_FLOWS.filter((f) => f.id === "select-native-fill-rejected-healer-recovers"),
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
    "meta objetivo del benchmark (spec AC1): 18/18 veredictos veraces (10 originales + 3 de cobertura del " +
      "healer HEALER-1 + 1 de HEALER-2 + 1 de cobertura genérica de alcance de modal + 1 de plan-pruning " +
      "genérico HEALER-4 + 2 de selectOption T1/F1) con el WIRING de la Capa 3 + oráculo de test determinista " +
      "(Fase 3a) — esto mide correctitud del wiring, NO precisión de un juez LLM real, que es explícitamente " +
      "Fase 3b/GHOST-30 y se valida contra el mismo ground truth de flows.ts",
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
