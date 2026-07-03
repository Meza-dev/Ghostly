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
import type { JudgeDossier, JudgeFn, JudgeVerdict } from "../src/index.js";
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
 * Juez ORÁCULO DE TEST — NO es el juez real (ese es GHOST-30, un LLM vía
 * `createJudge`). Es un doble determinista que clasifica el trigger SOLO a
 * partir de las señales que el dossier ya trae (deterministicChecks +
 * pageErrors), sin ningún LLM. Su único propósito es probar que el WIRING de
 * los 5 triggers de la Capa 3 (Fase 3a, este archivo) llega al lugar correcto
 * y aplica el veredicto correctamente — NO mide precisión de clasificación de
 * un juez real. GHOST-30 reemplazará esto por un juez con LLM real, validado
 * contra el mismo ground truth de `flows.ts`.
 */
/** Señales textuales de fallo de red/conexión (no de selector) en el mensaje de error de una acción fallida. */
const CONNECTION_ERROR_RE = /ERR_EMPTY_RESPONSE|ERR_CONNECTION_REFUSED|net::ERR_|ECONNREFUSED|ERR_NAME_NOT_RESOLVED/i;

const testOracleJudge: JudgeFn = async (dossier: JudgeDossier): Promise<JudgeVerdict> => {
  const victoryConfigured = dossier.deterministicChecks.some(
    (c) => c.check === "victory.configured" && c.passed,
  );
  const victoryConfiguredCheck = dossier.deterministicChecks.find((c) => c.check === "victory.configured");
  const victoryMetCheck = dossier.deterministicChecks.find((c) => c.check === "victory.met");
  const healerRecoveredCheck = dossier.deterministicChecks.find((c) => c.check === "healer.recovered");
  const connectionErrorAction = dossier.recentActions.find(
    (a) => a.outcome === "failed" && a.error && CONNECTION_ERROR_RE.test(a.error),
  );

  if (dossier.reason === "healing-exhausted" && connectionErrorAction) {
    // La acción falló por un error de RED/CONEXIÓN (server caído), no por un
    // selector mal resuelto — el entorno está roto, no la app ni el agente.
    // Ground truth: inconclusive-environment.
    return {
      verdict: "inconclusive-environment",
      confidence: "high",
      reasoning:
        "Test oracle (GHOST-29 wiring, no LLM real): healing-exhausted con un error de conexión de red " +
        `("${connectionErrorAction.error}") en la última acción — el servidor no respondió. No es un ` +
        "selector mal resuelto: es el entorno el que falló.",
      evidence: [`recentActions[].error matches connection-refused pattern`],
    };
  }

  if (dossier.reason === "healing-exhausted" && healerRecoveredCheck?.passed === false) {
    // El healer (y el replan del strategist) no encontraron el camino. En el
    // benchmark full-plan esto solo ocurre por un selector con typo cuyo
    // camino correcto SÍ existe en la página — ground truth: fail-agent-lost.
    return {
      verdict: "fail-agent-lost",
      confidence: "high",
      reasoning:
        "Test oracle (GHOST-29 wiring, no LLM real): healing-exhausted sin recuperación ni replan " +
        "productivo. El selector falló pero no hay evidencia de un error de la app (pageErrors vacío) — " +
        "el camino existía y Ghostly no lo encontró.",
      evidence: [`healer.recovered=false`, `pageErrors.length=${dossier.pageErrors.length}`],
    };
  }

  if (dossier.reason === "victory-candidate" && victoryConfiguredCheck && !victoryConfigured) {
    // Sin condición de victoria configurada: nunca hay evidencia suficiente
    // para afirmar nada — ground truth: inconclusive.
    return {
      verdict: "inconclusive",
      confidence: "high",
      reasoning:
        "Test oracle (GHOST-29 wiring, no LLM real): victory-candidate sin condición de victoria " +
        "configurada (victory.configured=false). Sin ella, ningún desenlace puede afirmarse con evidencia.",
      evidence: ["victory.configured=false"],
    };
  }

  if (dossier.reason === "victory-candidate" && victoryConfigured && victoryMetCheck?.passed === false) {
    // Victoria configurada pero nunca satisfecha y sin PageError de la app:
    // la condición de victoria (selector/texto/url) está mal definida — la
    // app en sí funcionó bien. Ground truth: fail-test-broken.
    return {
      verdict: "fail-test-broken",
      confidence: "high",
      reasoning:
        "Test oracle (GHOST-29 wiring, no LLM real): victory-candidate con condición configurada pero " +
        "nunca satisfecha (victory.met=false) y sin evidencia de error de la app. La condición de " +
        "victoria (selector/texto) está mal definida, no la app.",
      evidence: [`victory.met=false`, `pageErrors.length=${dossier.pageErrors.length}`],
    };
  }

  // Zona gris no cubierta por este oráculo (p. ej. error-signal, stalled,
  // budget-exhausted no ejercitados por los 10 flujos actuales): degrada a
  // inconclusive en vez de adivinar — mismo sesgo anti-falso-éxito del juez real.
  return {
    verdict: "inconclusive",
    confidence: "low",
    reasoning:
      `Test oracle (GHOST-29 wiring, no LLM real): trigger "${dossier.reason}" sin regla de clasificación ` +
      "en el oráculo — no hay flujo del benchmark que lo ejercite todavía.",
    evidence: [],
  };
};

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

  const deps: AssistedDeps = { strategist: noopStrategist, healer: noopHealer, judge: testOracleJudge };

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
    judgeInvocations: runResult.judgeEvents?.length ?? 0,
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
