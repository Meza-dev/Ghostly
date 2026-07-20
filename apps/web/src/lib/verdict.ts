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
 *
 * El texto NO vive acá: la meta expone keys i18n (`labelKey`/`shortKey`) que
 * cada componente resuelve con `t()` en el render.
 */

import type { MessageKey } from "../i18n/en";

export type Verdict =
  | "success"
  | "fail-app-bug"
  | "fail-test-broken"
  | "fail-agent-lost"
  | "inconclusive-environment"
  | "inconclusive";

export type VerdictTone = "success" | "primary" | "warning" | "muted";

export type VerdictMeta = {
  /** Key i18n de la etiqueta larga (tooltip del badge). */
  labelKey: MessageKey;
  /** Key i18n de la frase corta para listados/badges. */
  shortKey: MessageKey;
  tone: VerdictTone;
  /** true solo para `fail-app-bug` — dispara la presentación de "hallazgo". */
  isFinding: boolean;
};

const VERDICT_META: Record<Verdict, VerdictMeta> = {
  success: {
    labelKey: "verdict.success.label",
    shortKey: "verdict.success.short",
    tone: "success",
    isFinding: false,
  },
  "fail-app-bug": {
    labelKey: "verdict.failAppBug.label",
    shortKey: "verdict.failAppBug.short",
    tone: "primary",
    isFinding: true,
  },
  "fail-test-broken": {
    labelKey: "verdict.failTestBroken.label",
    shortKey: "verdict.failTestBroken.short",
    tone: "warning",
    isFinding: false,
  },
  "fail-agent-lost": {
    labelKey: "verdict.failAgentLost.label",
    shortKey: "verdict.failAgentLost.short",
    tone: "warning",
    isFinding: false,
  },
  "inconclusive-environment": {
    labelKey: "verdict.inconclusiveEnvironment.label",
    shortKey: "verdict.inconclusiveEnvironment.short",
    tone: "muted",
    isFinding: false,
  },
  inconclusive: {
    labelKey: "verdict.inconclusive.label",
    shortKey: "verdict.inconclusive.short",
    tone: "muted",
    isFinding: false,
  },
};

const UNCLASSIFIED_META: VerdictMeta = {
  labelKey: "verdict.unclassified.label",
  shortKey: "verdict.unclassified.short",
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

/**
 * Agrupación CARA AL USUARIO (3 estados). La taxonomía de 6 veredictos sigue
 * viva por debajo (panel "por qué" / `verdictReason`), pero los badges y pills
 * que ve el usuario solo muestran estos tres:
 *  - success: objetivo cumplido y verificado.
 *  - fail: falló TU app o TU test — bug encontrado + test mal armado.
 *  - ghostly: Ghostly no pudo dar un veredicto limpio (se perdió, entorno
 *    inestable, sin evidencia, sin clasificar). Es "un fail pero distinto":
 *    no es tu app la que falló, es la ejecución la que no concluyó.
 */
export type UserVerdictGroup = "success" | "fail" | "ghostly";

export type UserGroupMeta = {
  labelKey: MessageKey;
  /** Clase Tailwind del punto de color. */
  dot: string;
  /** Clase de texto de la etiqueta. */
  text: string;
};

const USER_GROUP_META: Record<UserVerdictGroup, UserGroupMeta> = {
  success: { labelKey: "verdict.group.success", dot: "bg-success-fg", text: "text-success-fg" },
  fail: { labelKey: "verdict.group.fail", dot: "bg-error-fg", text: "text-error-fg" },
  ghostly: { labelKey: "verdict.group.ghostly", dot: "bg-warning-fg", text: "text-warning-fg" },
};

const VERDICT_TO_GROUP: Record<Verdict, UserVerdictGroup> = {
  success: "success",
  "fail-app-bug": "fail",
  "fail-test-broken": "fail",
  "fail-agent-lost": "ghostly",
  "inconclusive-environment": "ghostly",
  inconclusive: "ghostly",
};

/** Grupo cara al usuario. `status="pass"` sin veredicto cuenta como éxito. */
export function getUserVerdictGroup(
  verdict: string | null | undefined,
  status?: string | null,
): UserVerdictGroup {
  if ((!verdict || !isKnownVerdict(verdict)) && status === "pass") return "success";
  if (verdict && isKnownVerdict(verdict)) return VERDICT_TO_GROUP[verdict];
  return "ghostly"; // null / sin clasificar / desconocido
}

export function getUserGroupMeta(group: UserVerdictGroup): UserGroupMeta {
  return USER_GROUP_META[group];
}
