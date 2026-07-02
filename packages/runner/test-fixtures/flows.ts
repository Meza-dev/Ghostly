/**
 * Flujos etiquetados del benchmark de fiabilidad (spec §7).
 *
 * 10 flujos, cada uno con: objetivo (goal), pasos concretos (full plan —
 * sin LLM), configuración de escenario del fixture app, y el veredicto
 * esperado (ground truth, etiquetado a mano) según la taxonomía de la
 * spec §5. Cubren los 6 desenlaces posibles.
 */
import type { AssistedRunInput } from "../src/index.js";
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
      victory: { selectorVisible: ['[data-testid="validation-error"]'], mustAll: true },
    },
    expectedVerdict: "success",
    rationale:
      "El objetivo del flujo es verificar que la validación rechaza el título vacío; el error visible ES la victoria (comportamiento esperado de la app), verificado por selector.",
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
];
