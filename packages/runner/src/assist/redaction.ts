/**
 * Boundary de redacción — el ÚNICO choke point para texto libre derivado de
 * goal/juez/página antes de que llegue a cualquier capa de persistencia o
 * exposición (DB, respuesta de API, evento `RunEvent`/SSE).
 *
 * Kanon GHOST-35 (spec §6 hardening, cierra la retrospectiva de v0.2): antes
 * de este módulo, la redacción de texto libre vivía duplicada y dispersa —
 * `apps/api/src/lib/redact-assist.ts` tenía su propia `SENSITIVE_WORDS` +
 * `redactGoal`, y `packages/runner/src/assist/judge.ts` tenía una copia
 * carácter-por-carácter (`SENSITIVE_TEXT_WORDS`) más `redactOrTruncateText`.
 * Cada slice nueva (GHOST-26 pageErrors, GHOST-31 verdictReason/judge events)
 * tuvo que "acordarse" de redactar su propio sink — eso es lo que causó los
 * 3 leaks de GHOST-31 (C1/C2/C3). Este módulo es el punto único: TODO texto
 * libre proveniente de goal del usuario, razonamiento/hint del juez, o
 * mensajes de error de página DEBE pasar por `redactOrTruncateText`/
 * `redactOrTruncateList` antes de salir del runner.
 *
 * Por qué NO es un tipo `Redacted<T>` forzado por el compilador: el runner
 * se consume como paquete compilado (`dist/`) desde `apps/api` y
 * `packages/mcp-server`, y un wrapper tipado agregaría fricción de tipos en
 * cada call site sin aportar más seguridad que la disciplina de "todo texto
 * libre pasa por acá antes de salir" + el test de auditoría exhaustivo
 * (`redaction-boundary-audit.test.ts`). Se mantiene deliberadamente LIGERO
 * (spec de esta slice): un choke point documentado + auditoría, no un tipo
 * nuevo.
 *
 * `apps/api` NO puede importar `apps/api/src/lib/redact-assist.ts` desde acá
 * (el runner nunca depende de apps/api, regla de arquitectura) — es al
 * revés: `apps/api` YA depende de `@ghostly-io/runner` como workspace
 * package (`workspace:*`, consumido desde `dist/`), así que este módulo
 * exporta `SENSITIVE_TEXT_WORDS` para que `redact-assist.ts` lo importe
 * como ÚNICA fuente de verdad — elimina la duplicación en vez de solo
 * testear que las dos copias no diverjan.
 */

const REDACTED = "[REDACTED]";

/**
 * Palabras que disparan redacción total de un campo de texto libre. Fuente
 * única de verdad — `apps/api/src/lib/redact-assist.ts` la importa desde
 * `@ghostly-io/runner` en vez de mantener su propia copia.
 */
export const SENSITIVE_TEXT_WORDS = [
  "password",
  "passwd",
  "token",
  "secret",
  "api key",
  "apikey",
  "authorization",
] as const;

/** Longitud máxima de un campo de texto libre persistido/expuesto (evita filas/payloads gigantes). */
const MAX_PERSISTED_TEXT_LENGTH = 1000;

function containsSensitiveWord(value: string): boolean {
  const normalized = value.toLowerCase();
  return SENSITIVE_TEXT_WORDS.some((word) => normalized.includes(word));
}

/** Trunca un texto libre a `MAX_PERSISTED_TEXT_LENGTH`, agregando un indicador de corte. */
function truncateText(value: string): string {
  if (value.length <= MAX_PERSISTED_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_PERSISTED_TEXT_LENGTH - 1)}…`;
}

/**
 * Redacta un campo de texto libre si contiene una palabra sensible; si no,
 * lo trunca. Este es el ÚNICO contrato de redacción de texto libre del
 * proyecto — todo sink nuevo que persista/exponga texto derivado de
 * goal/juez/página debe pasar por acá.
 */
export function redactOrTruncateText(value: string): string {
  if (containsSensitiveWord(value)) return REDACTED;
  return truncateText(value);
}

/** Redacta o trunca cada entrada de un array de texto libre (p. ej. `evidence`). */
export function redactOrTruncateList(values: string[]): string[] {
  return values.map(redactOrTruncateText);
}
