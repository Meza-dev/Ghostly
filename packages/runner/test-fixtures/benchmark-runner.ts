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
import type { HealerContext, HealerFn, HealerResult, JudgeDossier, JudgeFn, JudgeVerdict, Step } from "../src/index.js";
import { startFixtureApp, type FixtureApp } from "./app.js";
import { BENCHMARK_FLOWS, type BenchmarkFlow, type ExpectedVerdict } from "./flows.js";

export type ObservedVerdict = ExpectedVerdict | "unclassified";

export type BenchmarkFlowResult = {
  flow: BenchmarkFlow;
  observedVerdict: ObservedVerdict;
  truthful: boolean;
  falseSuccess: boolean;
  judgeInvocations: number;
  /** Cantidad de eventos `heal_start` emitidos por el pipeline durante este flujo. */
  healInvocations: number;
  /** Cantidad de eventos `heal_success` emitidos por el pipeline durante este flujo. */
  healSuccesses: number;
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

/**
 * Healer ORÁCULO DE TEST — NO es el healer real (ese es GHOST-3x, un LLM vía
 * `createHealer` + `HEALER_SYSTEM`, apps/api). Es un doble determinista y
 * basado en reglas que clasifica/recupera SOLO a partir de las señales que ya
 * trae `ctx` (snapshot del observer + failedStep + error), sin ningún LLM ni
 * red hacia un modelo. Mismo espíritu que `testOracleJudge`: probar que el
 * WIRING de heal_start/heal_action/heal_success llega al lugar correcto, no
 * medir la calidad de recuperación de un healer real.
 *
 * Cableado SIEMPRE (ver `runOneFlow`): solo se ejecuta cuando
 * `maxHealingAttemptsPerStep >= 1`, así que los 10 flujos existentes (que
 * mantienen `maxHealingAttemptsPerStep: 0`) nunca lo invocan (spec R6/D2).
 *
 * Reglas, en orden — la primera que matchea gana:
 *  - Rule A: selector renombrado — el testid falló pero existe una variante
 *    con el mismo "stem" (p. ej. `note-title-input` -> `note-title-input-v2`)
 *    en el snapshot, o cae a `name="title"` como alternativa.
 *  - Rule B: modal/overlay bloqueando — el error indica intercepción de
 *    puntero o hay un diálogo visible; antepone un click de dismiss SIN
 *    reemplazar el paso original (para que se reintente después).
 *  - Rule C: selector ambiguo — el error es una violación de strict-mode de
 *    Playwright; desambigua priorizando data-testid sobre el selector suelto.
 *  - Fallback: `{ steps: [] }` (igual que `noopHealer`) — deja un camino de
 *    fallo controlado para flujos que no matchean ninguna regla.
 */
const POINTER_INTERCEPT_RE = /intercepts pointer events|element is not visible|element is outside of the viewport|subtree intercepts pointer events/i;
const STRICT_MODE_VIOLATION_RE = /strict mode violation|resolved to \d+ elements/i;

/** Extrae el testid de un selector `[data-testid="..."]`, si el paso lo usa. */
function extractTestId(selector: string): string | undefined {
  const match = /\[data-testid=["']([^"']+)["']\]/.exec(selector);
  return match?.[1];
}

/** Extrae el "stem" de un testid quitando sufijos de versión tipo `-v2`. */
function testIdStem(testId: string): string {
  return testId.replace(/-v\d+$/i, "");
}

/** Busca en el treeMarkdown del snapshot un `data-testid="..."` cuyo stem coincida. */
function findRenamedTestId(treeMarkdown: string, stem: string): string | undefined {
  const re = /data-testid=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(treeMarkdown)) !== null) {
    const candidate = m[1]!;
    if (candidate !== stem && testIdStem(candidate) === stem) return candidate;
  }
  return undefined;
}

/**
 * Busca el `data-testid` de un candidato disambiguado a partir del bloque
 * "INTERACTIVOS VISIBLES" (observer.ts `buildVisibleInteractivesBlock`,
 * formato `- <tag> [data-testid="..."] ...`). Prioriza filas cuyo tag
 * coincide con la acción fallida (p. ej. `button` para un `click`) para no
 * disambiguar hacia un control no relacionado (p. ej. el input de título)
 * cuando hay múltiples data-testid visibles en la página.
 */
function findDataTestIdCandidate(treeMarkdown: string, preferredTag?: string): string | undefined {
  const rowRe = /^-\s+(\w+)(?:\[role=[^\]]+\])?\s+\[data-testid=["']([^"']+)["']\]/gm;
  const candidates: Array<{ tag: string; testId: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(treeMarkdown)) !== null) {
    candidates.push({ tag: m[1]!, testId: m[2]! });
  }
  if (preferredTag) {
    const preferred = candidates.find((c) => c.tag === preferredTag);
    if (preferred) return preferred.testId;
  }
  return candidates[0]?.testId;
}

const testOracleHealer: HealerFn = async (ctx: HealerContext): Promise<HealerResult> => {
  const { failedStep, error, snapshot } = ctx;
  const treeMarkdown = snapshot.treeMarkdown ?? "";
  const visibleDialogs = snapshot.visibleDialogs ?? [];

  // Rule B — modal/overlay bloqueando el click: antepone el dismiss y luego
  // reintenta el paso original explícitamente en la MISMA respuesta.
  //
  // Nota: el pipeline (`hasEquivalentReplacementStep`, pipeline.ts:1574) solo
  // compara acción+selector para decidir si un heal step "reemplaza" al
  // original — no distingue "antepongo un paso extra" de "reemplazo el
  // paso". Como el paso fallido y el dismiss son ambos `click` con selectores
  // distintos, el pipeline los trataría como reemplazo y OMITIRÍA el reintento
  // del guardado si solo devolviéramos el dismiss. Por eso Rule B devuelve
  // [dismiss, retry-del-original]: el segundo step, al tener EXACTAMENTE el
  // mismo selector que `failedStep`, hace que ese guardado se ejecute dentro
  // del propio loop de heal steps (pipeline.ts:2567-2610), sin depender del
  // branch de "reintento del original" que el pipeline saltearía.
  const overlayBlocking =
    POINTER_INTERCEPT_RE.test(error) || visibleDialogs.length > 0 || treeMarkdown.includes("confirm-dialog-ok");
  if (overlayBlocking && (failedStep.action === "click" || failedStep.action === "fill")) {
    const dismissStep: Step = { action: "click", selector: '[data-testid="confirm-dialog-ok"]' };
    return {
      steps: [dismissStep, failedStep],
      rationale: "Test oracle (HEALER-1, no LLM real): overlay/modal visible bloqueando el click — cerrando antes de reintentar.",
    };
  }

  // Rule C — violación de strict-mode (selector ambiguo, resuelve a N elementos): desambigua por data-testid.
  if (STRICT_MODE_VIOLATION_RE.test(error) && (failedStep.action === "click" || failedStep.action === "fill")) {
    // `fill` normalmente ambigua sobre inputs/textareas; `click` sobre botones/links.
    const preferredTag = failedStep.action === "fill" ? "input" : "button";
    const disambiguated = findDataTestIdCandidate(treeMarkdown, preferredTag);
    if (disambiguated) {
      const correctedSelector = `[data-testid="${disambiguated}"]`;
      const correctedStep: Step =
        failedStep.action === "fill"
          ? { action: "fill", selector: correctedSelector, value: failedStep.value }
          : { action: "click", selector: correctedSelector };
      return {
        steps: [correctedStep],
        rationale: "Test oracle (HEALER-1, no LLM real): strict-mode violation — desambiguando por data-testid.",
      };
    }
  }

  // Rule A — selector renombrado (testid con sufijo de versión distinto).
  if (failedStep.action === "click" || failedStep.action === "fill") {
    const failedTestId = extractTestId(failedStep.selector);
    if (failedTestId) {
      const stem = testIdStem(failedTestId);
      const renamed = findRenamedTestId(treeMarkdown, stem);
      if (renamed) {
        const correctedSelector = `[data-testid="${renamed}"]`;
        const correctedStep: Step =
          failedStep.action === "fill"
            ? { action: "fill", selector: correctedSelector, value: failedStep.value }
            : { action: "click", selector: correctedSelector };
        return {
          steps: [correctedStep],
          rationale: "Test oracle (HEALER-1, no LLM real): testid renombrado detectado en el snapshot — corrigiendo selector.",
        };
      }
      // Fallback: el campo de título sigue siendo alcanzable por name="title".
      if (failedStep.action === "fill" && /name=["']title["']/.test(treeMarkdown)) {
        return {
          steps: [{ action: "fill", selector: 'input[name="title"]', value: failedStep.value }],
          rationale: "Test oracle (HEALER-1, no LLM real): testid no encontrado — usando name=\"title\" como alternativa.",
        };
      }
    }
  }

  // Fallback: sin regla aplicable — mismo comportamiento que noopHealer (camino de fallo controlado).
  return { steps: [] };
};

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

  if (
    dossier.reason === "healing-exhausted" &&
    dossier.pageErrors.some((e) => e.severity === "blocking")
  ) {
    // HEALER-2 / H1: el healer cedió determinísticamente ante evidencia dura
    // de un error bloqueante de la app (misma correlación por índice que el
    // circuit breaker) — el paso falló, pero la causa raíz es la app, no el
    // agente perdiéndose un camino que existía. Ground truth: fail-app-bug.
    // Esta regla va ANTES que fail-agent-lost porque ambas comparten
    // `healer.recovered=false`; el desempate lo hace la presencia de un
    // pageError bloqueante.
    return {
      verdict: "fail-app-bug",
      confidence: "high",
      reasoning:
        "Test oracle (GHOST-29 wiring, no LLM real): healing-exhausted con al menos un PageError de " +
        "severidad 'blocking' correlacionado al paso fallido. El healer cedió al juez sin intentar curar " +
        "(HEALER-2/H1) — la evidencia apunta a un bug de la app, no a un selector mal resuelto.",
      evidence: [`pageErrors.some(severity==="blocking")`, `pageErrors.length=${dossier.pageErrors.length}`],
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

  // testOracleHealer va SIEMPRE cableado (design D2): solo se ejecuta cuando
  // `assist.maxHealingAttemptsPerStep >= 1`, así que los 10 flujos existentes
  // (que mantienen `maxHealingAttemptsPerStep: 0`) nunca lo invocan.
  //
  // `flow.strategist` (HEALER-4): opcional, usado solo por flujos que
  // necesitan pasos generados dinámicamente vía seed + expansión del
  // strategist (ver `BenchmarkFlow.strategist` en flows.ts). Ausente en
  // los demás flujos -> comportamiento previo sin cambios (noopStrategist).
  const deps: AssistedDeps = {
    strategist: flow.strategist ?? noopStrategist,
    healer: testOracleHealer,
    judge: testOracleJudge,
  };

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
    healInvocations: runResult.events.filter((e) => e.type === "heal_start").length,
    healSuccesses: runResult.events.filter((e) => e.type === "heal_success").length,
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
