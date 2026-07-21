import { redactGoalText, type AssistedMeta } from "@ghostly-io/runner";

/**
 * Redacta `assistedMeta.goal` antes de persistirlo (spec §6). Delega en el
 * boundary único de redacción de texto libre (`redactOrTruncateText`,
 * `packages/runner/src/assist/redaction.ts`, Kanon GHOST-35) en vez de
 * mantener su propia copia de `SENSITIVE_WORDS`/lógica — el runner y apps/api
 * NO pueden compartir código en runtime salvo vía el paquete publicado
 * (`@ghostly-io/runner`, consumido desde `dist/`), y ese paquete YA es una
 * dependencia de apps/api, así que importar la función real (no solo la
 * lista de palabras) elimina la duplicación por completo en vez de solo
 * evitar que diverja.
 */
export function redactAssistedMeta(meta: AssistedMeta): AssistedMeta {
  return {
    ...meta,
    goal: redactGoalText(meta.goal),
  };
}
