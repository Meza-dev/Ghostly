import { buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT, safeParseRunInput, validateJudgeVerdict } from "@ghostly-io/runner";
import type {
  HealerContext,
  HealerFn,
  HealerResult,
  CodeHints,
  JudgeDossier,
  JudgeFn,
  ObserverSnapshot,
  PlannedChunk,
  Step,
  StrategistContext,
  StrategistFn,
} from "@ghostly-io/runner";
import { completeJson } from "../llm/client.js";
import { providerSupportsImages } from "../llm/catalog.js";
import { resolveLlmConfig } from "../llm/config.js";
import { LlmError } from "../llm/errors.js";

type VisibleDialogHint = { heading?: string; ariaLabel?: string };
type PlanProgressLite = {
  step: Step;
  status: "pending" | "ok" | "failed" | "dropped";
  source?: string;
  horizon?: number;
  stepIndex?: number;
  note?: string;
};
type StrategistContextWithPlan = StrategistContext & { planProgress?: PlanProgressLite[] };

export class AssistOrchestratorError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const SELECTOR_FATIGUE_KEY_SEP = "::SEP::";

function selectorFatigueCounts(
  history: Array<{ step: Step; ok: boolean; error?: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const h of history) {
    if (h.ok) continue;
    if (h.step.action !== "click" && h.step.action !== "waitForSelector") continue;
    if (!("selector" in h.step)) continue;
    const key = `${h.step.action}${SELECTOR_FATIGUE_KEY_SEP}${h.step.selector}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Aviso al LLM cuando el mismo click/wait falló 2+ veces (evita bucle :has-text). */
function buildSelectorFatigueHint(history: Array<{ step: Step; ok: boolean; error?: string }>): string {
  const lines: string[] = [];
  for (const [key, n] of selectorFatigueCounts(history)) {
    if (n < 2) continue;
    const idx = key.indexOf(SELECTOR_FATIGUE_KEY_SEP);
    const action = key.slice(0, idx);
    const selector = key.slice(idx + SELECTOR_FATIGUE_KEY_SEP.length);
    lines.push(`- ${action} con selector ${JSON.stringify(selector)} → ${n} fallos en el historial`);
  }
  if (lines.length === 0) return "";
  return [
    "",
    "ATENCIÓN — fatiga de selector (el runner ya probó varios fallbacks por texto/rol):",
    ...lines,
    "Si un selector aparece arriba con 2+ fallos, NO lo repitas: usa del mapa name, id, placeholder, aria-label, data-testid o clase CSS estable (nunca [ref=e…]).",
  ].join("\n");
}

function buildPlanProgressHint(ctx: StrategistContextWithPlan): string {
  const progress = ctx.planProgress ?? [];
  if (progress.length === 0) return "";
  const lines = progress.slice(-60).map((p: PlanProgressLite, i: number) => {
    const st = p.status.toUpperCase();
    const src = p.source ? `/${p.source}` : "";
    const step = JSON.stringify(p.step);
    const suffix = p.note ? ` // ${p.note}` : "";
    return `  ${i + 1}. [${st}${src}] ${step}${suffix}`;
  });
  return [
    "",
    "ESTADO DEL PLAN (NO repetir pasos con estado OK):",
    ...lines,
    "Regla estricta: si un paso está en OK, está prohibido volver a planificarlo.",
  ].join("\n");
}

function buildModalFocusHint(snapshot: ObserverSnapshot): string {
  const d = (snapshot as ObserverSnapshot & { visibleDialogs?: VisibleDialogHint[] }).visibleDialogs;
  if (!d || d.length === 0) return "";
  const titles = d.map((x) => x.heading || x.ariaLabel || "(sin título)").join(" · ");
  return [
    "",
    "MODAL ABIERTO — alcance restringido:",
    `- Diálogo(s) visible(s): ${titles}`,
    "Interactúa solo con controles de este modal hasta guardar, enviar o cerrarlo. Ignora tabla, sidebar y botones de la página de fondo salvo que el objetivo lo pida explícitamente.",
  ].join("\n");
}

/** Alineado con el runner: título del modal + señales de formulario en el markdown del snapshot. */
function treeShowsCreateTripModalOpen(markdown: string): boolean {
  const t = markdown.toLowerCase();
  if (!t.includes("crear nuevo viaje")) return false;
  return (
    t.includes("conductorid") ||
    t.includes("vehiculoid") ||
    t.includes("remito") ||
    t.includes("react-select")
  );
}

function goalMentionsCreatingCalificacion(goal: string): boolean {
  const g = goal.replace(/\s+/g, " ");
  return (
    /(?:crear|crea)\s+(?:una\s+)?calific/i.test(g) ||
    /calific\w*.{0,24}(?:crear|crea|nueva|nuevo)/i.test(g) ||
    /nueva\s+calific/i.test(g)
  );
}

/** Panel tipo POTA: «Crear grupo» + campos de calificaciones del grupo (no es un overlay ajeno). */
function treeShowsCalificacionGroupModal(markdown: string): boolean {
  const t = markdown.toLowerCase();
  const hasTitle =
    t.includes("crear grupo") ||
    t.includes("crear grupos") ||
    t.includes("editar grupo") ||
    t.includes("editar grupos");
  if (!hasTitle) return false;
  return (
    t.includes("calificaciones del grupo") ||
    t.includes("valorización") ||
    t.includes("valorizacion") ||
    (t.includes("etiqueta") && t.includes("spinbutton"))
  );
}

function buildCalificacionGroupModalHint(goal: string, treeMarkdown: string): string {
  if (!goalMentionsCreatingCalificacion(goal)) return "";
  if (!treeShowsCalificacionGroupModal(treeMarkdown)) return "";
  return [
    "",
    "CONTEXTO — Formulario de creación (calificaciones / grupos):",
    "- Si ves un panel con heading «Crear grupo» y textos como «Calificaciones del grupo», placeholders de nombre/etiqueta y botones «Guardar»/«Cancelar», ese panel ES el flujo para crear la calificación o el grupo: rellena campos y pulsa «Guardar»; no lo interpretes como un overlay que tape el botón «Crear calificación».",
    "- Tras clic en «Crear calificación» (o equivalente), un mensaje de «sin mutación en el DOM» puede ser un falso negativo si este formulario ya está visible: prioriza `fill` y acciones dentro del modal; no propongas «Cerrar» salvo que el objetivo pida cancelar o descartar.",
    "- Mientras este formulario esté abierto, NO planifiques clics en «Diseño», «Calificaciones» del menú ni de nuevo en «Crear calificación» (quedan detrás del modal y fallan): sigue con `fill` en nombre/etiqueta/valorización y `click` en «Guardar».",
  ].join("\n");
}

/** Evita que el healer cierre un modal de creación cuando el objetivo es crear y el mapa ya muestra el formulario. */
/**
 * Con el modal «Crear grupo» abierto, los clics en el menú lateral suelen hacer timeout (tapados);
 * no aportan al objetivo de rellenar y guardar.
 */
function filterSidebarNavWhenCalificacionModalOpen(steps: Step[], goal: string, treeMarkdown: string): Step[] {
  if (!goalMentionsCreatingCalificacion(goal)) return steps;
  if (!treeShowsCalificacionGroupModal(treeMarkdown)) return steps;
  return steps.filter((st) => {
    if (st.action !== "click") return true;
    const low = st.selector.replace(/\s+/g, " ").toLowerCase();
    const touchesBlockedNav =
      /has-text\(\s*["']diseño["']\s*\)/i.test(low) ||
      /has-text\(\s*["']evaluador["']\s*\)/i.test(low) ||
      /has-text\(\s*["']auditor[ií]a["']\s*\)/i.test(low) ||
      /has-text\(\s*["']evaluado["']\s*\)/i.test(low) ||
      /has-text\(\s*["']calificaciones["']\s*\)/i.test(low) ||
      /has-text\(\s*["']crear calificaci[oó]n["']\s*\)/i.test(low) ||
      /text\s*=\s*["']?diseño["']?$/i.test(low) ||
      /text\s*=\s*["']?calificaciones["']?$/i.test(low);
    return !touchesBlockedNav;
  });
}

function filterMisleadingCloseForCalificacionCreateFlow(
  steps: Step[],
  goal: string,
  treeMarkdown: string,
): Step[] {
  if (!goalMentionsCreatingCalificacion(goal)) return steps;
  if (!treeShowsCalificacionGroupModal(treeMarkdown)) return steps;
  if (/cancelar|descartar|cerrar sin guardar|no guardar|volver atr[aá]s/i.test(goal)) return steps;
  return steps.filter((st) => {
    if (st.action !== "click") return true;
    const low = st.selector.replace(/\s+/g, " ").toLowerCase();
    const targetsGenericClose =
      /aria-label\s*=\s*["']cerrar["']/i.test(low) ||
      /\[aria-label\s*=\s*["']cerrar["']\]/i.test(low) ||
      /button:has-text\(\s*["']cerrar["']\s*\)/i.test(low) ||
      (/has-text\(\s*["']cerrar["']\s*\)/i.test(low) && /button|getbyrole/i.test(low));
    return !targetsGenericClose;
  });
}

function filterAlreadyCompletedPlanSteps(steps: Step[], ctx: StrategistContextWithPlan): Step[] {
  const progress = ctx.planProgress ?? [];
  if (progress.length === 0) return steps;
  const done = new Set(
    progress
      .filter((p) => p.status === "ok")
      .map((p) => canonicalStepKey(p.step)),
  );
  if (done.size === 0) return steps;
  return steps.filter((s) => !done.has(canonicalStepKey(s)));
}

function buildCreateTripModalSemanticHint(snapshot: ObserverSnapshot): string {
  if (!treeShowsCreateTripModalOpen(snapshot.treeMarkdown)) return "";
  return [
    "",
    "CONTEXTO — Formulario «Crear Nuevo Viaje» ya visible en el mapa (título + conductor/remitos/react-select):",
    "- NO emitas click ni wait sobre «Agregar Datos» (suele quedar detrás del modal; el click hace timeout).",
    '- NO uses `button` / getByRole(button) con el texto «Crear Nuevo Viaje»: en el DOM suele ser un `heading` (h3), no un botón.',
    "- El mapa embebido en el modal es normal (zoom, «Abrir en Google Maps», Terms): NO lo trates como error salvo que el mapa muestre texto de fallo («can't load», «no puede cargar»). Solo entonces el botón «OK» del aviso.",
    "- Si hay aviso de Google Maps con botón «OK», prioriza cerrarlo antes de rellenar o pulsar Continuar.",
    "- Sigue con `#react-select-*`, inputs del modal, filas Remito (`div[role=button]` con texto Remito) o el botón «Continuar» según INTERACTIVOS VISIBLES.",
  ].join("\n");
}

/** El widget de Maps incluye enlaces «Abrir en Google Maps», Terms, etc.; no son overlays bloqueantes. */
function filterGoogleMapsWidgetMisclickSteps(steps: Step[]): Step[] {
  return steps.filter((step) => {
    if (step.action !== "click" && step.action !== "waitForSelector") return true;
    const low = step.selector.toLowerCase();
    if (low.includes("open this area in google maps")) return false;
    if (low.includes("maps.google.com") || low.includes("google.com/maps")) return false;
    return true;
  });
}

function filterStaleCreateTripModalSteps(steps: Step[], snapshotMarkdown: string): Step[] {
  if (!treeShowsCreateTripModalOpen(snapshotMarkdown)) return steps;
  return steps.filter((step) => {
    if (step.action !== "click" && step.action !== "waitForSelector") return true;
    const sel = step.selector;
    const low = sel.toLowerCase();
    if (low.includes("agregar datos") || /aria-label\s*=\s*["']?agregar datos["']?/i.test(sel)) {
      return false;
    }
    if (!low.includes("crear nuevo viaje")) return true;
    const raw = sel.trim();
    if (/^h[1-6]:(has-text|text)\(/i.test(raw)) return true;
    if (low.startsWith("heading:has-text")) return true;
    if (step.action === "click" && (low.includes("button") || low.includes("role=button"))) return false;
    if (step.action === "waitForSelector" && low.includes("button")) return false;
    return true;
  });
}

const STRATEGIST_SYSTEM = [
  "Eres el Strategist de un runner E2E asistido (Ghostly v2).",
  "Recibes: (a) un objetivo, (b) la baseUrl, (c) un mapa simplificado del accessibility tree (mapa semántico) y (d) un historial breve.",
  "Debes proponer los PRÓXIMOS pasos (máximo el que te indique el usuario) usando EXCLUSIVAMENTE estas acciones:",
  '- { "action": "goto", "url": string } (misma baseUrl)',
  '- { "action": "click", "selector": string }',
  '- { "action": "fill", "selector": string, "value": string }',
  '- { "action": "press", "key": string }',
  '- { "action": "waitForSelector", "selector": string, "timeoutMs"?: number }',
  '- { "action": "snapshot" }',
  "Reglas:",
  "- Usa selectores CSS Playwright válidos. Prefiere atributos por rol/nombre/placeholder observables en el mapa.",
  "- No inventes campos ni pasos fuera del contrato.",
  "- Si el mapa solo muestra un banner/diálogo/overlay bloqueante (ej. botones 'Aceptar'/'Cancelar'/'OK' sin otro contenido real), tu PRIMER paso debe ser cerrarlo o aceptarlo antes de continuar.",
  "- Si el mapa parece incompleto o la página está cargando (pocos nodos, sin inputs visibles aun cuando el objetivo implica un formulario), emite primero un 'snapshot' o un 'waitForSelector' sobre un elemento plausible en lugar de alucinar selectores.",
  "- Si detectas un bloque 'Controles de formulario visibles detectados por DOM', priorízalo para elegir selectores reales (id, name, placeholder) en lugar de adivinar.",
  "- Si el mapa incluye el bloque 'Diálogos / modales aparentemente VISIBLES ahora', asume que esos modales están ABIERTOS para el usuario (no solo presentes en HTML oculto). No planifiques de nuevo clicks para abrir el mismo flujo si el título visible del modal ya corresponde al paso previo; sigue con waits sobre campos del formulario, rellenos o cierre de sub-diálogos (p. ej. OK en errores de mapas).",
  "- Si el mapa lista a la vez «Gestión de Viajes», el heading «Crear Nuevo Viaje» y controles del formulario (#conductorId, #vehiculoId, react-select, remitos), el modal de creación YA está abierto: no planifiques click en «Agregar Datos» ni un botón llamado «Crear Nuevo Viaje» (ese texto es un heading, no role=button).",
  "- Si el mapa ya muestra navegación/sidebar y enlaces funcionales, prioriza avanzar por ese flujo y NO intentes clicks de 'Aceptar/Cancelar' a menos que esos controles estén visibles en el bloque DOM.",
  "- NO repitas pasos ya exitosos del historial reciente (fill/click/wait) salvo que exista evidencia explícita de que el flujo volvió atrás.",
  "- Si recibes condición de victoria, orienta tus próximos pasos para cumplirla cuanto antes (no reinicies login si ya hay contexto autenticado).",
  "- PROHIBIDO usar selectores genéricos ambiguos como 'button', 'input', 'button[type=submit]', 'input[type=text]' sin un id/name/texto que los diferencie. Si existen varios elementos que matchean un mismo tipo, DEBES desambiguar con `:has-text(\"...\")`, `text=...`, `#id`, `[name=...]`, `[aria-label=\"...\"]` o `[placeholder=\"...\"]`.",
  "- TERMINANTEMENTE PROHIBIDO usar `[ref=e123]` o cualquier selector basado en ref= del mapa: esos índices son efímeros del snapshot a11y y NO son CSS válidos en el DOM.",
  "- Si un paso falló, NO repitas el mismo selector. Si en el mapa o en «INTERACTIVOS VISIBLES» el control tiene `#id`, `[data-testid]`, `[name]` o `[aria-label]` único, está PROHIBIDO preferir `:has-text` para ese control.",
  "- Prioridad cuando el mapa lo permita: (1) `#id`, `[data-testid=...]`, `[name=...]`, `[aria-label=...]`; (2) `button:has-text(\"...\")` / `a:has-text(\"...\")` / `text=...` solo si no hay atributo estable. El runner traduce texto de botón/enlace a getByRole antes que CSS.",
  "- Para ir a la sección «Viajes» del menú lateral, usa `a:has-text(\"Viajes\")` o enlace bajo `navigation`, no `text=Viajes` suelto: puede coincidir con el título de página «Gestión de Viajes» (substring).",
  "- Las entradas de un submenú desplegable (bajo «Diseño», etc.) suelen ser `button` dentro de `[role=menu]` o de `nav`, no enlaces `<a>`: si el mapa muestra `button text=\"Calificaciones\"`, usa `button:has-text(\"Calificaciones\")` (no `a:has-text`).",
  "- PROHIBIDO planificar click en «Open this area in Google Maps», Terms del mapa, «Keyboard shortcuts» del widget, o zoom del mapa salvo que el objetivo lo pida; no son el aviso de error.",
  "- Si el bloque «ATENCIÓN — fatiga de selector» aparece en el prompt de usuario, ese selector ya falló 2+ veces: OBLIGATORIO cambiar a name/id/placeholder/aria-label/clase del mapa; no emitas el mismo :has-text otra vez.",
  "- Si aparece «MODAL ABIERTO», solo planifica interacciones dentro del modal hasta cerrarlo o completar su acción.",
    "- Si el mapa muestra «Crear grupo» con «Calificaciones del grupo»/«Guardar» y el objetivo es crear una calificación, ese panel es el flujo de creación: rellena y guarda; no lo cierres con «Cerrar» salvo cancelación explícita.",
    "- Para inputs cuyo mapa muestre `textbox \"…\"` (placeholder accesible), usa `[placeholder=\"…\"]` o el mismo texto con `fill`; evita `text=…` suelto (suele ser etiqueta, no el input).",
  "- El runner espera solo a que desaparezcan textos típicos de carga en modales (p. ej. «Cargando documentos», «Cargando remitos») antes de planificar y entre pasos; no dupliques ese wait salvo que necesites un timeout distinto.",
  "- Condición `selectorVisible` en victoria: si el usuario escribió lenguaje natural (p. ej. «toast de confirmación»), tradúcelo a `text=...`, selector CSS real (`.toast-success`), o fragmento estable del mapa; nunca dejes frases sueltas sin traducir.",
  "- REGLA CRÍTICA: antes de proponer nuevos pasos, revisa historial + estado del plan. Si la última acción relevante fue «Guardar», «Enviar», «Confirmar», «Crear» y NO hay error explícito posterior, tu prioridad es verificar victoria; está PROHIBIDO repetir «Guardar/Crear/Enviar» sin evidencia de fallo previo.",
  "- Evita `button[type=submit]` a menos que el mapa lo respalde, porque muchos `<button>` no declaran `type=submit`.",
  'Responde SOLO un objeto JSON con forma EXACTA: { "steps": Step[], "hasMore": boolean, "rationale"?: string }.',
].join("\n");

const HEALER_SYSTEM = [
  "Eres el Healer del runner E2E asistido. Un paso falló.",
  "Recibes: el paso fallido, el error, el objetivo global, un mapa fresco del accessibility tree y un historial de pasos previos ya ejecutados.",
  "Objetivo: proponer 1 a 3 pasos previos que desbloqueen la acción (ej. cerrar banner de cookies, esperar un selector alternativo, abrir un menú, reemplazar el selector por uno más específico).",
  "NO repitas el paso fallido; tras tus pasos el runner lo reintentará automáticamente.",
  "PROHIBIDO repetir acciones que ya aparecen como OK en el historial (p. ej. volver a rellenar un input que ya fue llenado). Si el paso previo ya está hecho, NO lo incluyas.",
  "Analiza el error concretamente:",
  "- 'Timeout waiting for locator(...)' + múltiples elementos similares en el mapa => desambigua con id/name/aria-label del mapa; no insistas en el mismo :has-text si ya falló 2+ veces (mira bloque fatiga en el prompt).",
  "- 'strict mode violation' => misma lógica: desambigua con texto o atributo único.",
  "- Elemento tapado por overlay/banner => primer paso debe ser cerrar el overlay (click en su botón de cierre o 'Aceptar').",
  "- 'element not visible' con un botón en un modal activo => probablemente debes cerrar ese modal antes (salvo que el modal sea un formulario de creación alineado con el objetivo: entonces interactúa dentro o guarda).",
  "- Error «sin mutación» o timeout tras «Crear calificación»/equivalente: si el mapa incluye «Crear grupo», «Calificaciones del grupo» y «Guardar», trabaja dentro de ese formulario (fill, Guardar); no propongas «Cerrar»/aria-label Cerrar salvo que el objetivo pida cancelar.",
  "- Si el mapa ya está en home/sidebar y NO hay evidencia visible del overlay en el bloque DOM, NO propongas 'Aceptar/Cancelar'; propone continuar por el objetivo (ej. abrir menú destino) o un wait/snapshot.",
  "- Si el mapa muestra el formulario del modal «Crear Nuevo Viaje» (heading + conductor/remitos/react-select) y el fallo fue click en «Agregar Datos» o elemento tapado, prioriza botón «OK» de Google Maps o react-select / Continuar; no intentes reabrir el modal.",
  "- NUNCA propongas click en «Open this area in Google Maps» ni enlaces del chrome del mapa para «cerrar» el modal: el mapa embebido es parte del formulario. Solo «OK» si hay mensaje explícito de error de carga de Maps.",
  "Preferir selectores robustos: texto visible del mapa O aria-label/role si el mapa los muestra explícitamente; evita selectores genéricos.",
  "PROHIBIDO `[ref=e…]` en selectores; usa #id, [data-testid], [aria-label] del bloque INTERACTIVOS VISIBLES.",
  "Acciones permitidas (mismo contrato que Strategist).",
  'Responde SOLO un objeto JSON con forma EXACTA: { "steps": Step[], "rationale"?: string }.',
].join("\n");

function normalizeAction(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  if (v === "navigate") return "goto";
  if (v === "wait") return "waitForSelector";
  if (v === "type") return "fill";
  if (v === "keypress") return "press";
  if (v === "a11y" || v === "ariasnapshot") return "snapshot";
  return value.trim();
}

function stripLeadingDecorativeGlyphs(text: string): string {
  // Limpia íconos/fuentes decorativas al inicio, preservando texto legible.
  return text.replace(/^[^\p{L}\p{N}"']+/u, "").replace(/\s+/g, " ").trim();
}

function normalizePlannerSelector(selector: string): string {
  let s = selector.trim();
  if (!s) return s;

  // `textbox[...]` viene del mapa a11y; para Playwright CSS real usamos solo el selector de atributo.
  s = s.replace(/^textbox(\[[^\]]+\])$/i, "$1");

  // El LLM a veces concatena texto al tipo submit; no es CSS válido y el runner degenera en `button[type=submit]` solo.
  const brokenSubmitText = s.match(
    /^button\[type\s*=\s*['"]?submit['"]?\]\s+text\s*=\s*(['"])([\s\S]*?)\1/i,
  );
  if (brokenSubmitText?.[2]) {
    const clean = stripLeadingDecorativeGlyphs(brokenSubmitText[2]);
    if (clean) {
      const q = clean.includes('"') ? "'" : '"';
      const inner = q === '"' ? clean.replace(/"/g, '\\"') : clean.replace(/'/g, "\\'");
      s = `button:has-text(${q}${inner}${q})`;
    }
  }

  const hText = s.match(/^h([1-6]):text\((['"])([\s\S]*?)\2\)/i);
  if (hText?.[3] !== undefined) {
    const q = hText[2]!;
    s = `heading:has-text(${q}${hText[3]}${q})`;
  }
  const hHas = s.match(/^h([1-6]):has-text\((['"])([\s\S]*?)\2\)/i);
  if (hHas?.[3] !== undefined && !hText) {
    const q = hHas[2]!;
    s = `heading:has-text(${q}${hHas[3]}${q})`;
  }

  // `link:has-text(...)` suele venir del LLM por el rol ARIA; en Playwright CSS
  // necesitamos `a:has-text(...)`.
  s = s.replace(/^link(?=\s*:)/i, "a");

  const hasTextMatch = s.match(/:has-text\((['"])([\s\S]*?)\1\)/i);
  if (hasTextMatch) {
    const quote = hasTextMatch[1] ?? '"';
    const rawText = hasTextMatch[2] ?? "";
    const cleanText = stripLeadingDecorativeGlyphs(rawText);
    if (cleanText) {
      s = s.replace(/:has-text\((['"])([\s\S]*?)\1\)/i, `:has-text(${quote}${cleanText}${quote})`);
    }
  }

  const textEngineMatch = s.match(/^text=(.+)$/i);
  if (textEngineMatch) {
    const raw = textEngineMatch[1]?.trim() ?? "";
    const clean = stripLeadingDecorativeGlyphs(raw.replace(/^['"]|['"]$/g, ""));
    if (clean) s = `text=${clean}`;
  }

  return s;
}

function canonicalStepKey(step: Step): string {
  if (step.action === "goto") return `goto|${step.url.trim()}`;
  if (step.action === "press") return `press|${step.key.trim().toLowerCase()}`;
  if (step.action === "click") return `click|${normalizePlannerSelector(step.selector).toLowerCase()}`;
  if (step.action === "waitForSelector") return `wait|${normalizePlannerSelector(step.selector).toLowerCase()}`;
  if (step.action === "fill") return `fill|${normalizePlannerSelector(step.selector).toLowerCase()}|${step.value}`;
  return "snapshot";
}

function coerceStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const action = normalizeAction(obj.action ?? obj.type ?? obj.name);
  if (!action) return null;
  if (action === "goto") {
    const url = obj.url ?? obj.path ?? obj.target;
    if (typeof url !== "string" || !url.trim()) return null;
    return { action: "goto", url: url.trim() };
  }
  if (action === "click") {
    const selector = obj.selector ?? obj.target ?? obj.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    return { action: "click", selector: normalizePlannerSelector(selector) };
  }
  if (action === "fill") {
    const selector = obj.selector ?? obj.target ?? obj.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    const value = obj.value ?? obj.text ?? "";
    return {
      action: "fill",
      selector: normalizePlannerSelector(selector),
      value: typeof value === "string" ? value : String(value),
    };
  }
  if (action === "press") {
    const key = obj.key ?? obj.value ?? "Enter";
    return { action: "press", key: typeof key === "string" ? key : String(key) };
  }
  if (action === "waitForSelector") {
    const selector = obj.selector ?? obj.target ?? obj.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    const timeoutMs = obj.timeoutMs ?? obj.timeout;
    if (typeof timeoutMs === "number") {
      return { action: "waitForSelector", selector: normalizePlannerSelector(selector), timeoutMs };
    }
    return { action: "waitForSelector", selector: normalizePlannerSelector(selector) };
  }
  if (action === "snapshot") return { action: "snapshot" };
  return null;
}

const AMBIGUOUS_SELECTORS = new Set([
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "button[type=submit]",
  "button[type=\"submit\"]",
  "button[type='submit']",
  "input[type=text]",
  "input[type=\"text\"]",
  "input[type='text']",
  "input[type=password]",
  "input[type=\"password\"]",
  "input[type='password']",
  "input[type=email]",
  "input[type=\"email\"]",
  "input[type='email']",
  "[type=submit]",
  "form button",
  "form input",
]);

function isAmbiguousSelector(selector: string): boolean {
  const norm = selector.trim().toLowerCase().replace(/\s+/g, " ");
  return AMBIGUOUS_SELECTORS.has(norm);
}

function isIconOnlyTextSelector(selector: string): boolean {
  const s = selector.trim();
  const hasTextMatch = s.match(/:has-text\((['"])([\s\S]*?)\1\)/i);
  if (hasTextMatch?.[2] !== undefined) {
    const cleaned = stripLeadingDecorativeGlyphs(hasTextMatch[2]);
    if (!cleaned) return true;
  }
  const textEngine = s.match(/^text=(.+)$/i)?.[1];
  if (textEngine !== undefined) {
    const cleaned = stripLeadingDecorativeGlyphs(textEngine.replace(/^['"]|['"]$/g, ""));
    if (!cleaned) return true;
  }
  return false;
}

function rejectAmbiguous(steps: Step[]): Step[] {
  return steps.filter((s) => {
    if (s.action === "click" || s.action === "fill" || s.action === "waitForSelector") {
      if (isAmbiguousSelector(s.selector)) return false;
      if (isIconOnlyTextSelector(s.selector)) return false;
    }
    return true;
  });
}

function coerceStepsArray(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  const base = raw.map(coerceStep).filter((v): v is Step => v !== null);
  return rejectAmbiguous(base);
}

function hasSidebarContext(snapshotMarkdown: string): boolean {
  const hay = snapshotMarkdown.toLowerCase();
  return (
    hay.includes("navigation [ref=") ||
    hay.includes("link \"") ||
    hay.includes("sidebar")
  );
}

function hasVisibleDomControlText(snapshotMarkdown: string, label: string): boolean {
  const idx = snapshotMarkdown.indexOf("Controles de formulario visibles detectados por DOM:");
  if (idx < 0) return false;
  const section = snapshotMarkdown.slice(idx).toLowerCase();
  return section.includes(`text="${label.toLowerCase()}"`);
}

function isOverlayDismissStep(step: Step): boolean {
  if (step.action !== "click") return false;
  const s = step.selector.toLowerCase();
  return (
    s.includes("aceptar") ||
    s.includes("cancelar") ||
    s.includes("ok") ||
    s.includes("cerrar")
  );
}

function filterFalseOverlaySteps(steps: Step[], snapshotMarkdown: string): Step[] {
  if (!hasSidebarContext(snapshotMarkdown)) return steps;
  return steps.filter((step) => {
    if (!isOverlayDismissStep(step)) return true;
    const selector = step.action === "click" ? step.selector.toLowerCase() : "";
    const hasAceptar = selector.includes("aceptar");
    const hasCancelar = selector.includes("cancelar");
    const hasOk = selector.includes("ok");
    const hasCerrar = selector.includes("cerrar");
    if (hasAceptar && hasVisibleDomControlText(snapshotMarkdown, "Aceptar")) return true;
    if (hasCancelar && hasVisibleDomControlText(snapshotMarkdown, "Cancelar")) return true;
    if (hasOk && hasVisibleDomControlText(snapshotMarkdown, "OK")) return true;
    if (hasCerrar && hasVisibleDomControlText(snapshotMarkdown, "Cerrar")) return true;
    return false;
  });
}

function isDebugEnabled(): boolean {
  const raw = (process.env.ASSIST_LLM_DEBUG ?? "").trim().toLowerCase();
  if (raw === "") return process.env.NODE_ENV !== "production";
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function debugLog(label: string, data: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const line = `[assist-llm:${label}] ${JSON.stringify(data)}`;
  console.info(line);
}

async function callLlmJson(
  system: string,
  user: string,
  timeoutMs: number,
  label: string = "llm",
  image?: { base64: string; mimeType: string },
): Promise<Record<string, unknown>> {
  try {
    return await completeJson(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { timeoutMs, label, ...(image ? { image } : {}) },
    );
  } catch (error) {
    if (error instanceof LlmError && error.status === 504) {
      debugLog(label, { stage: "timeout", timeoutMs });
      throw new AssistOrchestratorError("Timeout al consultar LLM", 504);
    }
    if (error instanceof LlmError) {
      debugLog(label, { stage: "error", message: error.message });
      throw new AssistOrchestratorError("LLM no disponible", 502);
    }
    debugLog(label, {
      stage: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw new AssistOrchestratorError("Error LLM", 502);
  }
}

function buildStrategistUserPrompt(ctx: StrategistContextWithPlan, chunkSize: number): string {
  const historyLine = ctx.history
    .slice(-5)
    .map(
      (h: StrategistContext["history"][number], i: number) =>
        `  ${i + 1}. ${h.step.action} ${h.ok ? "OK" : `FAIL: ${h.error?.slice(0, 120) ?? ""}`}`,
    )
    .join("\n");
  const victoryLines = ctx.victory
    ? [
      "Condición de victoria configurada:",
      `- textIncludes: ${JSON.stringify(ctx.victory.textIncludes ?? [])}`,
      `- selectorVisible: ${JSON.stringify(ctx.victory.selectorVisible ?? [])}`,
      `- urlIncludes: ${JSON.stringify(ctx.victory.urlIncludes ?? [])}`,
      `- mustAll: ${String(ctx.victory.mustAll ?? false)}`,
    ].join("\n")
    : "Condición de victoria: (no configurada)";

  const fatigue = buildSelectorFatigueHint(ctx.history);
  const fatigueBlock = fatigue ? `${fatigue}\n` : "";
  const planProgressHint = buildPlanProgressHint(ctx);
  const modalHint = buildModalFocusHint(ctx.snapshot);
  const createTripHint = buildCreateTripModalSemanticHint(ctx.snapshot);
  const calificacionModalHint = buildCalificacionGroupModalHint(ctx.goal, ctx.snapshot.treeMarkdown);

  return [
    `Objetivo: ${ctx.goal}`,
    `baseUrl: ${ctx.baseUrl}`,
    `Máximo de pasos en esta respuesta: ${chunkSize}`,
    "",
    victoryLines,
    "",
    "Mapa semántico actual (accessibility tree simplificado):",
    ctx.snapshot.treeMarkdown,
    planProgressHint,
    modalHint,
    createTripHint,
    calificacionModalHint,
    fatigueBlock,
    historyLine ? `Historial reciente:\n${historyLine}` : "Historial: (vacío)",
  ].join("\n");
}

function buildCodeHintsBlock(codeHints: CodeHints | undefined): string {
  if (!codeHints) return "";
  const testIds = new Set<string>();
  const ariaLabels = new Set<string>();
  const formLines: string[] = [];

  for (const component of codeHints.components ?? []) {
    for (const testId of component.testIds ?? []) testIds.add(testId);
    for (const ariaLabel of component.ariaLabels ?? []) ariaLabels.add(ariaLabel);
  }

  for (const form of codeHints.forms ?? []) {
    const inputs = (form.inputs ?? [])
      .map((input) => {
        const stableSelector = input.testId
          ? `[data-testid="${input.testId}"]`
          : input.ariaLabel
            ? `[aria-label="${input.ariaLabel}"]`
            : input.name
              ? `[name="${input.name}"]`
              : input.placeholder
                ? `[placeholder="${input.placeholder}"]`
                : undefined;
        return stableSelector
          ? `${stableSelector}${input.type ? ` (${input.type})` : ""}`
          : undefined;
      })
      .filter((input): input is string => !!input);
    if (inputs.length === 0) continue;
    const submit = form.submitTestId
      ? ` submit=[data-testid="${form.submitTestId}"]`
      : form.submitLabel
        ? ` submit="${form.submitLabel}"`
        : "";
    formLines.push(`- ${form.name}: ${inputs.join(", ")}${submit}`);
  }

  const lines = [
    "SELECTORES CONOCIDOS DEL CÓDIGO FUENTE (manifest MCP):",
    testIds.size > 0 ? `data-testid disponibles: ${Array.from(testIds).sort().join(", ")}` : "",
    ariaLabels.size > 0 ? `aria-labels disponibles: ${Array.from(ariaLabels).sort().join(", ")}` : "",
    formLines.length > 0 ? `Formularios detectados:\n${formLines.join("\n")}` : "",
    "Prioriza estos selectores y sus agrupaciones de formulario sobre selectores genéricos o derivados solo del accessibility tree.",
  ].filter(Boolean);

  return lines.length > 1 ? lines.join("\n") : "";
}

function buildHealerUserPrompt(ctx: HealerContext): string {
  const history = ctx.history ?? [];
  const historyLines = history
    .slice(-8)
    .map((h, i) => {
      const status = h.ok ? "OK" : `FAIL: ${(h.error ?? "").slice(0, 120)}`;
      return `  ${i + 1}. [${status}] ${JSON.stringify(h.step)}`;
    })
    .join("\n");
  const fatigue = buildSelectorFatigueHint(history);
  const modalHint = buildModalFocusHint(ctx.snapshot);
  const createTripHint = buildCreateTripModalSemanticHint(ctx.snapshot);
  const calificacionModalHint = buildCalificacionGroupModalHint(ctx.goal, ctx.snapshot.treeMarkdown);
  const codeHintsBlock = buildCodeHintsBlock(ctx.codeHints);

  return [
    `Objetivo: ${ctx.goal}`,
    `baseUrl: ${ctx.baseUrl}`,
    `Paso fallido: ${JSON.stringify(ctx.failedStep)}`,
    `Error: ${ctx.error.slice(0, 600)}`,
    "",
    historyLines ? `Historial de pasos previos (NO los repitas si están OK):\n${historyLines}` : "Historial: (vacío)",
    ...(codeHintsBlock ? ["", codeHintsBlock] : []),
    ...(fatigue ? ["", fatigue] : []),
    ...(modalHint ? ["", modalHint] : []),
    ...(createTripHint ? ["", createTripHint] : []),
    ...(calificacionModalHint ? ["", calificacionModalHint] : []),
    "",
    "Mapa semántico actual:",
    ctx.snapshot.treeMarkdown,
  ].join("\n");
}

export type OrchestratorOptions = {
  llmTimeoutMs: number;
  chunkSize: number;
  codeHints?: CodeHints;
};

export function createStrategist(opts: OrchestratorOptions): StrategistFn {
  return async (ctx: StrategistContext) => {
    const withPlan = ctx as StrategistContextWithPlan;
    const user = buildStrategistUserPrompt(withPlan, opts.chunkSize);
    debugLog("strategist", {
      stage: "context",
      goal: ctx.goal,
      baseUrl: ctx.baseUrl,
      historyCount: ctx.history.length,
      snapshotNodeCount: ctx.snapshot.nodeCount,
      snapshotUrl: ctx.snapshot.url,
    });
    const raw: Record<string, unknown> = await callLlmJson(
      STRATEGIST_SYSTEM,
      user,
      opts.llmTimeoutMs,
      "strategist",
    ).catch(() => ({}) as Record<string, unknown>);
    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    const steps = filterAlreadyCompletedPlanSteps(
      filterSidebarNavWhenCalificacionModalOpen(
        filterMisleadingCloseForCalificacionCreateFlow(
          filterGoogleMapsWidgetMisclickSteps(
            filterStaleCreateTripModalSteps(
              filterFalseOverlaySteps(
                coerceStepsArray(rawSteps).slice(0, opts.chunkSize),
                ctx.snapshot.treeMarkdown,
              ),
              ctx.snapshot.treeMarkdown,
            ),
          ),
          ctx.goal,
          ctx.snapshot.treeMarkdown,
        ),
        ctx.goal,
        ctx.snapshot.treeMarkdown,
      ),
      withPlan,
    );
    const hasMore =
      typeof raw.hasMore === "boolean" ? raw.hasMore : steps.length === opts.chunkSize;
    const safe = safeParseRunInput(
      {
        baseUrl: ctx.baseUrl,
        steps: steps.length > 0 ? steps : [{ action: "snapshot" as const }],
        defaultTimeoutMs: 30_000,
      },
      { enforceSameOrigin: true, maxSteps: opts.chunkSize, maxTimeoutMs: 120_000 },
    );
    const validSteps = safe.success ? safe.data.steps : [];
    const chunk: PlannedChunk = {
      steps: validSteps.map((step) => ({ step })),
      hasMore,
    };
    debugLog("strategist", {
      stage: "chunk",
      hasMore: chunk.hasMore,
      stepCount: chunk.steps.length,
      steps: chunk.steps.map((s) => s.step),
    });
    return chunk;
  };
}

export function createHealer(opts: OrchestratorOptions): HealerFn {
  return async (ctx: HealerContext) => {
    const user = buildHealerUserPrompt({ ...ctx, ...(opts.codeHints ? { codeHints: opts.codeHints } : {}) });
    debugLog("healer", {
      stage: "context",
      goal: ctx.goal,
      baseUrl: ctx.baseUrl,
      failedStep: ctx.failedStep,
      error: ctx.error.slice(0, 300),
      snapshotNodeCount: ctx.snapshot.nodeCount,
    });
    const raw: Record<string, unknown> = await callLlmJson(
      HEALER_SYSTEM,
      user,
      opts.llmTimeoutMs,
      "healer",
    ).catch(() => ({}) as Record<string, unknown>);
    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    const steps = filterSidebarNavWhenCalificacionModalOpen(
      filterMisleadingCloseForCalificacionCreateFlow(
        filterGoogleMapsWidgetMisclickSteps(
          filterStaleCreateTripModalSteps(
            filterFalseOverlaySteps(
              coerceStepsArray(rawSteps).slice(0, 3),
              ctx.snapshot.treeMarkdown,
            ),
            ctx.snapshot.treeMarkdown,
          ),
        ),
        ctx.goal,
        ctx.snapshot.treeMarkdown,
      ),
      ctx.goal,
      ctx.snapshot.treeMarkdown,
    );
    const rationale = typeof raw.rationale === "string" ? raw.rationale : undefined;
    const result: HealerResult = { steps, ...(rationale ? { rationale } : {}) };
    debugLog("healer", {
      stage: "result",
      stepCount: result.steps.length,
      steps: result.steps,
      rationale: result.rationale,
    });
    return result;
  };
}

/**
 * Adjunta el screenshot del dossier (si el runner lo capturó Y el provider
 * del usuario soporta imágenes) a la request del LLM. El dossier de texto
 * (`buildJudgeUserPrompt`) es SIEMPRE autosuficiente — la imagen es evidencia
 * EXTRA, nunca la única fuente (spec §4.3 "híbrido según provider"). Gating
 * por capacidad vive acá, no en el runner: el runner nunca decide nada sobre
 * providers/LLMs.
 */
function buildJudgeImageAttachment(dossier: JudgeDossier): { base64: string; mimeType: string } | undefined {
  if (!dossier.screenshot) return undefined;
  const config = resolveLlmConfig();
  if (!providerSupportsImages(config.providerId)) return undefined;
  return { base64: dossier.screenshot.toString("base64"), mimeType: "image/png" };
}

/**
 * El juez real (spec §4.3, Fase 3b — GHOST-30): factory con el mismo patrón
 * de inyección que `createStrategist`/`createHealer` — envuelve el LLM del
 * usuario (`UserLlmSettings`, resuelto vía `resolveLlmConfig()`/
 * `runWithLlmConfigAsync`, exactamente igual que strategist/healer) con el
 * prompt de sistema del juez (`JUDGE_SYSTEM_PROMPT`, spec §4.3 reglas 1-5) y
 * el dossier serializado a texto (`buildJudgeUserPrompt`, ambos PUROS y
 * probados en el runner con LLM mocks — ver `judge-prompt.test.ts`).
 *
 * Validación de la respuesta (Zod + reintento único ante output malformado,
 * degradando a `inconclusive`) vive en `validateJudgeVerdict` (runner,
 * `judge.ts`) — mismo patrón que el sanitizador del healer. Esta función solo
 * hace el wiring: arma el prompt, gatea el screenshot por capacidad del
 * provider, llama al LLM, y delega la validación.
 */
export function createJudge(opts: OrchestratorOptions): JudgeFn {
  return async (dossier: JudgeDossier) => {
    const user = buildJudgeUserPrompt(dossier);
    const image = buildJudgeImageAttachment(dossier);
    debugLog("judge", {
      stage: "context",
      goal: dossier.goal,
      reason: dossier.reason,
      recentActionsCount: dossier.recentActions.length,
      pageErrorsCount: dossier.pageErrors.length,
      hasScreenshot: Boolean(dossier.screenshot),
      imageAttached: Boolean(image),
    });
    const verdict = await validateJudgeVerdict(() =>
      callLlmJson(JUDGE_SYSTEM_PROMPT, user, opts.llmTimeoutMs, "judge", image),
    );
    debugLog("judge", {
      stage: "verdict",
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      evidenceCount: verdict.evidence.length,
    });
    return verdict;
  };
}
