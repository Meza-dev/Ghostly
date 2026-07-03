/**
 * Runner del benchmark de fiabilidad (spec §7).
 *
 * Ejecuta los 10 flujos etiquetados (`flows.ts`) contra la app fixture
 * (`app.ts`) usando el pipeline asistido real (`runAssistedFlow`), en modo
 * full-plan (sin LLM: los pasos ya vienen resueltos, así el benchmark corre
 * offline y determinista). Como el pipeline HOY no produce un `verdict`
 * (spec causa raíz #6), este runner infiere un "veredicto observado" a
 * partir de heurísticas equivalentes a las reglas duras de la Capa 2 que
 * las fases siguientes implementarán — el objetivo es medir el gap actual,
 * no adelantar la implementación real del juez.
 */
import { runAssistedFlow, type AssistedDeps, type AssistedRunResult } from "../src/index.js";
import { startFixtureApp, type FixtureApp } from "./app.js";
import { BENCHMARK_FLOWS, type BenchmarkFlow, type ExpectedVerdict } from "./flows.js";

export type ObservedVerdict = ExpectedVerdict | "unclassified";

export type BenchmarkFlowResult = {
  flow: BenchmarkFlow;
  observedVerdict: ObservedVerdict;
  truthful: boolean;
  falseSuccess: boolean;
  judgeInvocations: number;
  runResult: AssistedRunResult;
};

export type BenchmarkReport = {
  results: BenchmarkFlowResult[];
  truthfulCount: number;
  total: number;
  falseSuccessCount: number;
  inconclusiveRate: number;
  judgeInvocationsTotal: number;
};

/** Strategist que nunca debería ser llamado: los flujos usan pasos ya resueltos (full-plan). */
const noopStrategist: AssistedDeps["strategist"] = async () => {
  throw new Error(
    "El benchmark usa flujos full-plan; el strategist no debería invocarse. " +
      "Si esto se dispara, revisa que el flujo tenga los pasos completos.",
  );
};

/** Healer inerte: hoy no hay reintentos automáticos en los flujos del benchmark (maxHealingAttemptsPerStep=0). */
const noopHealer: AssistedDeps["healer"] = async () => ({ steps: [] });

/**
 * Infiere el desenlace observado a partir del resultado crudo del pipeline actual.
 * Esto NO es el juez real (Fase 3) — es una clasificación equivalente mínima para poder
 * comparar contra las etiquetas del benchmark y medir el gap de hoy.
 *
 * Desde la Fase 2a, el pipeline puede producir un `verdict` real (circuit breaker
 * determinista, spec §4.2a): cuando está presente, es la fuente de verdad y se usa
 * directo, sin heurística. El resto de los casos (Fases 2b/3 aún no implementadas)
 * sigue infiriéndose por heurística hasta que esas fases produzcan su propio `verdict`.
 */
function inferObservedVerdict(flow: BenchmarkFlow, result: AssistedRunResult): ObservedVerdict {
  if (result.verdict) return result.verdict;

  const lastOutcome = result.steps.at(-1);
  const allStepsOk = result.steps.length > 0 && result.steps.every((s) => s.ok);

  if (!allStepsOk) {
    // Un paso falló en ejecución (selector no encontrado, timeout, conexión rechazada, etc.)
    const err = (lastOutcome?.error ?? "").toLowerCase();
    if (/econnrefused|net::err|navigation|timeout.*goto/.test(err) && flow.scenario === "app-down") {
      return "inconclusive-environment";
    }
    // El pipeline hoy no distingue "selector no existe en el DOM real" (test mal armado)
    // de "el agente no encontró el camino" (agente perdido): ambos hoy son un simple fail
    // de ejecución. Sin Capa 2/3, no hay forma de diferenciarlos — se reporta "unclassified".
    return "unclassified";
  }

  // Todos los pasos "ejecutaron" sin error de Playwright. El pipeline hoy solo mira `ok`
  // (booleano), no hay verdict — inferimos éxito si el `ok` global es true.
  if (result.ok) return "success";
  return "unclassified";
}

async function runOneFlow(baseUrl: string, flow: BenchmarkFlow): Promise<BenchmarkFlowResult> {
  const scenarioUrl = new URL(flow.steps[0]!.action === "goto" ? flow.steps[0]!.url : "/", baseUrl);
  scenarioUrl.searchParams.set("scenario", flow.scenario);

  const steps = flow.steps.map((step, index) =>
    index === 0 && step.action === "goto" ? { ...step, url: scenarioUrl.pathname + scenarioUrl.search } : step,
  );

  const deps: AssistedDeps = { strategist: noopStrategist, healer: noopHealer };

  const runResult = await runAssistedFlow(
    {
      baseUrl,
      steps,
      headless: true,
      captureA11yAfterEachStep: false,
      captureScreenshotAfterEachStep: false,
      recordVideoOnFailure: false,
      artifactsDir: "artifacts",
      defaultTimeoutMs: 8_000,
      assist: flow.assist,
    },
    deps,
  );

  const observedVerdict = inferObservedVerdict(flow, runResult);
  const truthful = observedVerdict === flow.expectedVerdict;
  const falseSuccess = observedVerdict === "success" && flow.expectedVerdict !== "success";

  return {
    flow,
    observedVerdict,
    truthful,
    falseSuccess,
    judgeInvocations: 0, // el juez no existe todavía (Fase 3a/3b) — placeholder deliberado
    runResult,
  };
}

export async function runReliabilityBenchmark(
  flows: BenchmarkFlow[] = BENCHMARK_FLOWS,
): Promise<BenchmarkReport> {
  const app: FixtureApp = await startFixtureApp();
  try {
    const results: BenchmarkFlowResult[] = [];
    for (const flow of flows) {
      results.push(await runOneFlow(app.baseUrl, flow));
    }

    const truthfulCount = results.filter((r) => r.truthful).length;
    const falseSuccessCount = results.filter((r) => r.falseSuccess).length;
    const inconclusiveCount = results.filter(
      (r) => r.observedVerdict === "inconclusive" || r.observedVerdict === "inconclusive-environment",
    ).length;

    return {
      results,
      truthfulCount,
      total: results.length,
      falseSuccessCount,
      inconclusiveRate: results.length > 0 ? inconclusiveCount / results.length : 0,
      judgeInvocationsTotal: results.reduce((acc, r) => acc + r.judgeInvocations, 0),
    };
  } finally {
    await app.close();
  }
}

/** Imprime una tabla legible del reporte por consola (usada por el test y por uso manual). */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`Benchmark de fiabilidad — ${report.truthfulCount}/${report.total} veredictos veraces`);
  lines.push(`Falsos éxitos: ${report.falseSuccessCount}`);
  lines.push(`Tasa de inconclusive: ${(report.inconclusiveRate * 100).toFixed(0)}%`);
  lines.push(`Invocaciones del juez (total): ${report.judgeInvocationsTotal}`);
  lines.push("");
  for (const r of report.results) {
    const mark = r.truthful ? "OK" : "FAIL";
    lines.push(
      `[${mark}] ${r.flow.id} — esperado=${r.flow.expectedVerdict} observado=${r.observedVerdict}${r.falseSuccess ? " (FALSO ÉXITO)" : ""}`,
    );
  }
  return lines.join("\n");
}
