/**
 * Clasificación de errores de conectividad del recon: distingue "la app bajo
 * prueba no responde" de cualquier otro fallo inesperado. Función pura para
 * poder testearla sin infraestructura.
 */

/**
 * Devuelve true solo cuando el mensaje corresponde claramente a un fallo de
 * navegación/conectividad de Playwright contra la app objetivo:
 * - cualquier error de red de Chromium (`net::ERR_*`: CONNECTION_REFUSED,
 *   NAME_NOT_RESOLVED, CONNECTION_TIMED_OUT, ADDRESS_UNREACHABLE, EMPTY_RESPONSE, etc.)
 * - timeout de `page.goto` durante la navegación inicial
 */
export function isTargetUnreachableError(message: string): boolean {
  if (/net::ERR_/.test(message)) return true;
  return /page\.goto/.test(message) && /Timeout \d+\s*ms exceeded/i.test(message);
}

/** Mensaje claro para el usuario: el problema es del entorno objetivo, no de Ghostly. */
export function buildTargetUnreachableMessage(baseUrl: string): string {
  return `No se pudo alcanzar la aplicación en ${baseUrl}. La app bajo prueba no responde (¿está levantada?). El problema es del entorno objetivo, no de Ghostly.`;
}
