/**
 * Flujos etiquetados del benchmark de fiabilidad (spec §7).
 *
 * 10 flujos, cada uno con: objetivo (goal), pasos concretos (full plan —
 * sin LLM), configuración de escenario del fixture app, y el veredicto
 * esperado (ground truth, etiquetado a mano) según la taxonomía de la
 * spec §5. Cubren los 6 desenlaces posibles.
 */
import type { AssistedDeps, AssistedRunInput } from "../src/index.js";
import type { FixtureScenario } from "./app.js";

export type ExpectedVerdict =
  | "success"
  | "fail-app-bug"
  | "fail-test-broken"
  | "fail-agent-lost"
  | "inconclusive-environment"
  | "inconclusive";

export type BenchmarkFlow = {
  id: string;
  goal: string;
  scenario: FixtureScenario;
  /** Pasos concretos ejecutados en modo full-plan (assist.isFullPlan = true, sin strategist real). */
  steps: AssistedRunInput["steps"];
  assist: NonNullable<AssistedRunInput["assist"]>;
  expectedVerdict: ExpectedVerdict;
  /** Por qué este es el veredicto correcto — para el humano que etiqueta/revisa. */
  rationale: string;
  /**
   * Strategist determinista opcional (sin LLM), usado SOLO por flujos que
   * necesitan pasos generados dinámicamente (p. ej. el net de plan-pruning
   * de HEALER-4: `pendingSteps` de un plan full-plan/seed nunca pasan por
   * `shouldDropPlannedStep`, así que ese flujo necesita un seed `goto /` +
   * expansión vía strategist para poder ejercitar el path de poda). Si está
   * ausente, `benchmark-runner.ts` usa `noopStrategist` (comportamiento
   * previo, sin cambios para los demás flujos).
   */
  strategist?: AssistedDeps["strategist"];
};

const DEFAULT_ASSIST_BASE = {
  v2: true as const,
  isFullPlan: true as const,
  // stepsPerHorizon alto: en modo full-plan los pasos ya vienen resueltos
  // (sin strategist real), así que un solo horizonte alcanza para ejecutar
  // el plan completo de cada flujo del benchmark.
  maxHorizons: 1,
  stepsPerHorizon: 10,
  maxLoopMs: 30_000,
  maxHealingAttemptsPerStep: 0,
};

export const BENCHMARK_FLOWS: BenchmarkFlow[] = [
  {
    id: "happy-path-create-note",
    goal: "Crear una nota con título 'Reunión de equipo' y verificar que se guardó",
    scenario: "happy-path",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Reunión de equipo" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Reunión de equipo' y verificar que se guardó",
      victory: { textIncludes: ["Reunión de equipo"], mustAll: true },
    },
    expectedVerdict: "success",
    rationale: "La nota se persiste y el texto aparece en la tabla tras el guardado. Éxito real, verificable.",
  },
  {
    id: "no-victory-condition-is-inconclusive",
    goal: "Explorar la página de notas y crear una nota con título 'Comprar café'",
    scenario: "happy-path",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Comprar café" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Explorar la página de notas y crear una nota con título 'Comprar café'",
      // Sin `victory` configurada: la spec §4.2 exige que el desenlace lo decida
      // SIEMPRE el juez (nunca el strategist ni una heurística). Hoy no hay juez,
      // así que la evidencia no alcanza para afirmar nada — inconclusive genuino.
    },
    expectedVerdict: "inconclusive",
    rationale:
      "Sin condición de victoria configurada, ni el motor ni el strategist pueden afirmar éxito por sí solos (spec 4.2). La evidencia disponible no alcanza para ningún otro veredicto — debe ser 'inconclusive', nunca 'success' por default.",
  },
  {
    id: "500-on-save-cuts-run",
    goal: "Crear una nota con título 'Presupuesto Q3' y verificar que se guardó",
    scenario: "500-on-save",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Presupuesto Q3" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Presupuesto Q3' y verificar que se guardó",
      victory: { textIncludes: ["Presupuesto Q3"], mustAll: true },
    },
    expectedVerdict: "fail-app-bug",
    rationale: "El guardado responde 500: la app está rota. El test hizo su trabajo — encontró un bug (spec AC2).",
  },
  {
    id: "validation-reject-is-app-bug-not-agent-fault",
    goal: "Crear una nota sin completar el título y guardarla igual",
    scenario: "validation-reject",
    steps: [
      { action: "goto", url: "/" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota sin completar el título y guardarla igual",
      // revalidate: false — la condición de victoria es un mensaje de validación
      // EFÍMERO (solo visible en la respuesta inmediata del POST rechazado), no
      // un dato persistido. El double-check de persistencia (spec §4.2b) es para
      // objetivos que implican guardar estado; este goal menciona "crear"/"guardar"
      // por texto, pero la condición de victoria en sí no reclama persistencia —
      // opt-out explícito, tal como prevé la spec §9 para este caso exacto.
      victory: {
        selectorVisible: ['[data-testid="validation-error"]'],
        mustAll: true,
        revalidate: false,
      },
    },
    expectedVerdict: "success",
    rationale:
      "El objetivo del flujo es verificar que la validación rechaza el título vacío; el error visible ES la victoria (comportamiento esperado de la app), verificado por selector. La condición es efímera por diseño (no persiste tras recargar) — revalidate:false documenta que este flujo no reclama persistencia.",
  },
  {
    id: "non-persisting-save-no-false-success",
    goal: "Crear una nota con título 'Nota efímera' y verificar que sigue ahí tras recargar",
    scenario: "non-persisting-save",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Nota efímera" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Nota efímera' y verificar que sigue ahí tras recargar",
      victory: { textIncludes: ["Nota efímera"], mustAll: true },
    },
    expectedVerdict: "fail-app-bug",
    rationale:
      "El POST responde éxito (toast) pero la nota nunca se persiste — no sobrevive un reload. Double-check de persistencia (spec AC3) debe atrapar esto: es un bug de la app, no un success.",
  },
  {
    id: "modal-blocking-button-needs-continue",
    goal: "Crear una nota con título 'Con confirmación' y verificar que se guardó",
    scenario: "modal-blocking-button",
    steps: [
      { action: "goto", url: "/" },
      { action: "click", selector: '[data-testid="confirm-dialog-ok"]' },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Con confirmación" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Con confirmación' y verificar que se guardó",
      victory: { textIncludes: ["Con confirmación"], mustAll: true },
    },
    expectedVerdict: "success",
    rationale:
      "El modal de confirmación tapa el formulario al cargar; cerrarlo es un obstáculo recuperable (spec AC4 — continue con hint). Con el modal cerrado, el guardado es real y verificable.",
  },
  {
    id: "ephemeral-toast-persists-despite-fleeting-message",
    goal: "Crear una nota con título 'Toast fugaz' y verificar que se guardó",
    scenario: "ephemeral-toast",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Toast fugaz" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Toast fugaz' y verificar que se guardó",
      victory: { textIncludes: ["Toast fugaz"], mustAll: true },
    },
    expectedVerdict: "success",
    rationale:
      "A diferencia de 'non-persisting-save', acá la nota SÍ queda guardada en el store; solo el toast es efímero. La victoria se verifica por el texto persistido en la tabla, no por el toast.",
  },
  {
    id: "app-down-is-environment-issue",
    goal: "Crear una nota con título 'No importa' y verificar que se guardó",
    scenario: "app-down",
    steps: [{ action: "goto", url: "/" }],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'No importa' y verificar que se guardó",
      victory: { textIncludes: ["No importa"], mustAll: true },
      maxLoopMs: 10_000,
    },
    expectedVerdict: "inconclusive-environment",
    rationale:
      "El server rechaza la conexión (app caída). No es culpa del test ni del agente: es el entorno. No debe contar como fail en tendencias (spec §5).",
  },
  {
    id: "test-broken-wrong-victory-selector",
    goal: "Crear una nota con título 'Selector inexistente' y verificar que se guardó",
    scenario: "happy-path",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Selector inexistente" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Selector inexistente' y verificar que se guardó",
      victory: { selectorVisible: ['[data-testid="this-selector-does-not-exist"]'], mustAll: true },
    },
    expectedVerdict: "fail-test-broken",
    rationale:
      "El guardado real funciona (la app está bien), pero la condición de victoria apunta a un selector que jamás existirá en esta página. El plan/test está mal definido, no la app.",
  },
  {
    id: "agent-lost-selector-typo-recoverable-path-exists",
    goal: "Crear una nota con título 'Camino existente' y verificar que se guardó",
    scenario: "happy-path",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input-TYPO"]', value: "Camino existente" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Camino existente' y verificar que se guardó",
      victory: { textIncludes: ["Camino existente"], mustAll: true },
      maxHealingAttemptsPerStep: 0,
    },
    expectedVerdict: "fail-agent-lost",
    rationale:
      "El campo de título existe con un selector correcto y accesible ([data-testid=\"note-title-input\"]); el plan usa un selector con typo y no lo recupera. El camino existía — Ghostly no lo encontró.",
  },

  // --- HEALER-1: 3 flujos con maxHealingAttemptsPerStep >= 1, prueban que
  // testOracleHealer (benchmark-runner.ts) recupera catch->heal->retry en
  // escenarios reales (no solo el wiring del juez). Ver spec R4/AC1-3.
  {
    id: "selector-renamed-healer-recovers",
    goal: "Crear una nota con título 'Renombrado' y verificar que se guardó",
    scenario: "selector-renamed",
    steps: [
      { action: "goto", url: "/" },
      // Selector DELIBERADAMENTE viejo/stale: el fixture renderiza
      // data-testid="note-title-input-v2" para este escenario.
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Renombrado" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Renombrado' y verificar que se guardó",
      // `selectorVisible` apunta a una celda de la TABLA persistida, no a
      // `textIncludes` libre: un `textIncludes` matchea también el VALOR
      // tipeado en el textbox antes del submit (el snapshot del observer
      // incluye el valor del input), lo que produciría un candidato a
      // victoria prematuro justo después del heal-fill (antes del click) y
      // dispararía el double-check de persistencia (spec §4.2b) demasiado
      // pronto — el dato aún no se guardó. Acotar a `td:has-text(...)`
      // (celda de `notes-table`) asegura que solo cuenta como victoria una
      // vez que la fila fue realmente renderizada por el servidor tras el POST.
      victory: { selectorVisible: ['[data-testid="notes-table"] td:has-text("Renombrado")'], mustAll: true },
      maxHealingAttemptsPerStep: 1,
    },
    expectedVerdict: "success",
    rationale:
      "El testid del título fue renombrado (v2), pero el healer lo detecta en el snapshot y corrige el selector. El guardado persiste — éxito real, recuperado por heal.",
  },
  {
    id: "modal-overlay-needs-heal-dismiss",
    goal: "Crear una nota con título 'Con overlay' y verificar que se guardó",
    scenario: "modal-blocking-button",
    steps: [
      { action: "goto", url: "/" },
      // Sin paso scripteado de dismiss del modal (delta vs
      // modal-blocking-button-needs-continue): el click de guardar queda
      // interceptado por el overlay y dispara el heal.
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Con overlay" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Con overlay' y verificar que se guardó",
      // Ver nota en selector-renamed-healer-recovers: `selectorVisible` acotado a
      // la celda de la tabla persistida evita un candidato a victoria prematuro
      // por el valor tipeado en el textbox (aún no guardado) tras el heal.
      victory: { selectorVisible: ['[data-testid="notes-table"] td:has-text("Con overlay")'], mustAll: true },
      maxHealingAttemptsPerStep: 1,
    },
    expectedVerdict: "success",
    rationale:
      "El modal de confirmación tapa el botón de guardar sin que el plan lo cierre explícitamente; el healer detecta el diálogo visible y antepone el dismiss antes de reintentar el guardado. Éxito real, recuperado por heal.",
  },
  // --- HEALER-2 / H1: el paso THROWS (waitForSelector agota su timeout)
  // mientras un PageError bloqueante (network 500, disparado por un fetch
  // asíncrono lanzado por el click previo) queda correlacionado al mismo
  // índice — el healer debe ceder al juez sin gastar intentos (ver design
  // HEALER-2, "Coverage design"). maxHealingAttemptsPerStep: 1 asegura que
  // el healer está CABLEADO (probaría que el abstain lo saltea, no que
  // nunca hubiera corrido).
  {
    id: "blocking-error-healer-abstains",
    goal: "Crear una nota con título 'Abstención del healer' y verificar que se guardó",
    scenario: "500-on-save-blocking-throw",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Abstención del healer" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
      {
        action: "waitForSelector",
        selector: '[data-testid="notes-table"] td:has-text("Abstención del healer")',
        timeoutMs: 3_000,
      },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Abstención del healer' y verificar que se guardó",
      victory: {
        selectorVisible: ['[data-testid="notes-table"] td:has-text("Abstención del healer")'],
        mustAll: true,
      },
      maxLoopMs: 15_000,
      maxHealingAttemptsPerStep: 1,
    },
    expectedVerdict: "fail-app-bug",
    rationale:
      "El click dispara un fetch asíncrono que responde 500 recién mientras el paso siguiente espera la fila " +
      "persistida (que nunca llega). El healer está cableado pero cede determinísticamente ante la evidencia " +
      "de error bloqueante (HEALER-2/H1) en vez de gastar un intento de heal — la app está rota, no el selector.",
  },
  {
    id: "ambiguous-duplicate-selector",
    goal: "Crear una nota con título 'Ambiguo' y verificar que se guardó",
    scenario: "ambiguous-duplicate-selector",
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Ambiguo" },
      // Selector suelto/ambiguo a propósito: matchea 2 botones ".save-btn".
      { action: "click", selector: ".save-btn" },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Ambiguo' y verificar que se guardó",
      // Ver nota en selector-renamed-healer-recovers: `selectorVisible` acotado a
      // la celda de la tabla persistida evita un candidato a victoria prematuro
      // por el valor tipeado en el textbox (aún no guardado) tras el heal.
      victory: { selectorVisible: ['[data-testid="notes-table"] td:has-text("Ambiguo")'], mustAll: true },
      maxHealingAttemptsPerStep: 1,
    },
    expectedVerdict: "success",
    rationale:
      "El selector `.save-btn` matchea dos botones (violación de strict-mode); el healer desambigua priorizando el data-testid canónico del botón real. Éxito real, recuperado por heal.",
  },
  // --- HEALER-3: cobertura genérica del alcance de modal (sin strings de
  // dominio). El plan scripteado intenta clickear un control de fondo/sidebar
  // mientras el modal de confirmación está abierto; el backdrop intercepta el
  // click por puntero y el healer (Rule B — visibleDialogs.length>0) antepone
  // el dismiss y reintenta. Prueba la señal estructural genérica
  // (ObserverSnapshot.visibleDialogs), no un match de texto de dominio.
  {
    id: "modal-open-background-click-ignored",
    goal: "Crear una nota con título 'Modal enfocado' y verificar que se guardó",
    scenario: "modal-open-background-click-ignored",
    steps: [
      { action: "goto", url: "/" },
      // Click de fondo/sidebar mientras el modal está abierto: queda
      // pointer-intercepted por `.modal-overlay-backdrop` y dispara el heal.
      { action: "click", selector: '[data-testid="sidebar-other-action"]' },
      { action: "fill", selector: '[data-testid="note-title-input"]', value: "Modal enfocado" },
      { action: "click", selector: '[data-testid="save-note-button"]' },
    ],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Crear una nota con título 'Modal enfocado' y verificar que se guardó",
      // Ver nota en selector-renamed-healer-recovers: `selectorVisible` acotado a
      // la celda de la tabla persistida evita un candidato a victoria prematuro
      // por el valor tipeado en el textbox (aún no guardado) tras el heal.
      victory: { selectorVisible: ['[data-testid="notes-table"] td:has-text("Modal enfocado")'], mustAll: true },
      maxHealingAttemptsPerStep: 1,
    },
    expectedVerdict: "success",
    rationale:
      "El modal de confirmación tapa el control de fondo/sidebar; el click de fondo queda pointer-intercepted por el backdrop y el healer (Rule B — visibleDialogs visible) antepone el dismiss antes de reintentar. El guardado posterior es real y verificable — cobertura genérica del alcance de modal sin ningún string de dominio.",
  },
  // --- HEALER-4: net de plan-pruning genérico (sin strings de dominio),
  // corrido ANTES de tocar pipeline.ts para probar que el mecanismo genérico
  // ya existente (`shouldDropRedundantModalOpenClick` sobre
  // `ObserverSnapshot.visibleDialogs`) cubre el caso que hoy resuelven los
  // matchers de dominio (#12/#13) que este slice va a reemplazar/eliminar.
  //
  // `pendingSteps` de un plan full-plan/seed NUNCA pasan por
  // `shouldDropPlannedStep` (pipeline.ts ~2307) — solo lo hacen los steps que
  // vienen del strategist (~2234) o del replan (~2877). Por eso este flujo usa
  // un seed `goto /` (dispara `looksLikeSeedInputPlan` -> expansión vía
  // strategist) en vez de un plan scripteado completo, con un strategist
  // ORÁCULO DE TEST determinista (no LLM) que devuelve, en un solo chunk, un
  // click REDUNDANTE (duplica el heading del dialog ya abierto) seguido del
  // dismiss + fill + save reales.
  {
    id: "redundant-reopen-dropped-while-dialog-open",
    goal: "Cerrar la confirmación redundante y guardar una nota con título 'Poda redundante'",
    scenario: "modal-open-redundant-reopen-dropped",
    steps: [{ action: "goto", url: "/" }],
    assist: {
      ...DEFAULT_ASSIST_BASE,
      goal: "Cerrar la confirmación redundante y guardar una nota con título 'Poda redundante'",
      victory: { selectorVisible: ['[data-testid="notes-table"] td:has-text("Poda redundante")'], mustAll: true },
      maxHorizons: 3,
      stepsPerHorizon: 10,
    },
    expectedVerdict: "success",
    rationale:
      "El dialog genérico 'Confirmar guardado' ya está abierto al cargar la página; el strategist oráculo " +
      "propone un click redundante que duplica textualmente el heading del dialog visible antes del dismiss " +
      "real. El pipeline debe DROPPEAR ese click redundante vía el mecanismo genérico ya existente " +
      "(`shouldDropRedundantModalOpenClick`, visibleDialogs heading match) sin ningún string de dominio — y " +
      "el resto del plan (dismiss real + fill + save) igual llega a success.",
    // NOTA: NO usar un contador/flag por closure aquí (`let served`) — este
    // strategist vive en el array module-level `BENCHMARK_FLOWS`, compartido
    // por TODAS las corridas del benchmark dentro del mismo proceso de test
    // (varios `it(...)` llaman a `runReliabilityBenchmark()` con el mismo
    // objeto de flow). Una closure con estado mutable persistiría "ya
    // servido" entre corridas independientes y rompería la segunda corrida
    // en adelante. En cambio, se decide en base a `history` (fresco por cada
    // `runAssistedFlow`): si ya hay un intento de guardado real en el
    // historial, el chunk ya fue servido y ejecutado.
    strategist: async ({ history }) => {
      const saveAlreadyAttempted = history.some(
        (h) => h.step.action === "click" && h.step.selector === '[data-testid="save-note-button"]',
      );
      if (saveAlreadyAttempted) return { steps: [], hasMore: false };
      return {
        steps: [
          // REDUNDANTE: duplica el heading "Confirmar guardado" del dialog ya
          // visible -> DEBE ser dropeado por shouldDropRedundantModalOpenClick.
          { step: { action: "click", selector: "text=Confirmar guardado" } },
          // Dismiss real del dialog.
          { step: { action: "click", selector: '[data-testid="confirm-dialog-ok"]' } },
          { step: { action: "fill", selector: '[data-testid="note-title-input"]', value: "Poda redundante" } },
          { step: { action: "click", selector: '[data-testid="save-note-button"]' } },
        ],
        hasMore: false,
      };
    },
  },
];
