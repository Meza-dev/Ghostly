/**
 * Taxonomía de veredictos (spec §5, ghostly-v0.2-trust-release) — mapeo puro
 * veredicto → presentación. Compartido entre run-detail (badge + panel "por
 * qué") y runs-panel (filtro + badge de fila) para que ambos lean la misma
 * fuente de verdad de producto.
 *
 * `fail-app-bug` NO es un color de error: spec §5/§6 lo define como un
 * HALLAZGO ("el test hizo su trabajo, encontró un bug") — usa el tono
 * `primary` (marca), no `error`, para que el dashboard no lo presente como
 * vergüenza.
 */

export type Verdict =
  | "success"
  | "fail-app-bug"
  | "fail-test-broken"
  | "fail-agent-lost"
  | "inconclusive-environment"
  | "inconclusive";

export type VerdictTone = "success" | "primary" | "warning" | "muted";

export type VerdictMeta = {
  label: string;
  /** Frase corta para listados/badges. */
  shortLabel: string;
  tone: VerdictTone;
  /** true solo para `fail-app-bug` — dispara la presentación de "hallazgo". */
  isFinding: boolean;
};

const VERDICT_META: Record<Verdict, VerdictMeta> = {
  success: {
    label: "Objetivo cumplido y verificado",
    shortLabel: "Éxito",
    tone: "success",
    isFinding: false,
  },
  "fail-app-bug": {
    label: "Ghostly encontró un problema en tu app",
    shortLabel: "Bug encontrado",
    tone: "primary",
    isFinding: true,
  },
  "fail-test-broken": {
    label: "El plan o la condición de victoria están mal definidos",
    shortLabel: "Test mal armado",
    tone: "warning",
    isFinding: false,
  },
  "fail-agent-lost": {
    label: "Ghostly no encontró el camino aunque existía",
    shortLabel: "Ghostly se perdió",
    tone: "warning",
    isFinding: false,
  },
  "inconclusive-environment": {
    label: "El entorno falló (timeout, red, app caída)",
    shortLabel: "Entorno inestable",
    tone: "muted",
    isFinding: false,
  },
  inconclusive: {
    label: "La evidencia no alcanza para afirmar nada",
    shortLabel: "Sin evidencia suficiente",
    tone: "muted",
    isFinding: false,
  },
};

const UNCLASSIFIED_META: VerdictMeta = {
  label: "Sin clasificar (run anterior a v0.2)",
  shortLabel: "Sin clasificar",
  tone: "muted",
  isFinding: false,
};

function isKnownVerdict(value: string): value is Verdict {
  return value in VERDICT_META;
}

/** Nunca lanza: veredictos desconocidos/`null`/`undefined` caen en "sin clasificar". */
export function getVerdictMeta(verdict: string | null | undefined): VerdictMeta {
  if (!verdict || !isKnownVerdict(verdict)) return UNCLASSIFIED_META;
  return VERDICT_META[verdict];
}

/**
 * Meta considerando el `status` del run. Una victoria determinista limpia deja
 * `verdict=null` pero `status="pass"` — el pipeline NO setea `verdict="success"`
 * a propósito, porque la guardia de memoria (spec §6) usa `verdict===undefined`
 * como señal de éxito determinista para persistir AssistMemory. Semánticamente
 * `status="pass"` ES un éxito, así que acá lo mostramos como "success" en vez de
 * "sin clasificar". Los runs históricos (fail/null) siguen cayendo en su meta.
 */
export function getEffectiveVerdictMeta(
  verdict: string | null | undefined,
  status?: string | null,
): VerdictMeta {
  if ((!verdict || !isKnownVerdict(verdict)) && status === "pass") {
    return VERDICT_META.success;
  }
  return getVerdictMeta(verdict);
}

export const ALL_VERDICTS: Verdict[] = [
  "success",
  "fail-app-bug",
  "fail-test-broken",
  "fail-agent-lost",
  "inconclusive-environment",
  "inconclusive",
];
