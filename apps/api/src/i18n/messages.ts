// Catálogo bilingüe de mensajes fijos que el API devuelve al cliente
// (Opción A del diseño i18n-bilingual-en-es: server-side dict + Accept-Language).
// `en` es la fuente de verdad; toda key requiere par `es` (compile-checked por
// el propio literal `Record`, sin necesidad de un segundo archivo).
export const messages = {
  "common.invalidJsonBody": { en: "invalid JSON body", es: "cuerpo JSON inválido" },
  "common.labelRequired": { en: "label is required", es: "label requerido" },
  "common.notFound": { en: "not found", es: "no encontrado" },
  "common.forbidden": { en: "forbidden", es: "prohibido" },
  "common.validationError": { en: "validation error", es: "validación" },

  "auth.emailPasswordRequired": { en: "email and password are required", es: "email y password requeridos" },
  "auth.invalidCredentials": { en: "invalid credentials", es: "credenciales inválidas" },
  "auth.adminOnlyRegister": { en: "only an admin can create users", es: "solo el admin puede crear usuarios" },
  "auth.emailAlreadyRegistered": { en: "email already registered", es: "email ya registrado" },
  "auth.invalidOrExpiredToken": { en: "invalid or expired token", es: "token inválido o expirado" },
  "auth.sessionExpired": {
    en: "session expired, please log in again",
    es: "sesión expirada, vuelve a iniciar sesión",
  },
  "auth.invalidApiKey": { en: "invalid API key", es: "API Key inválida" },
  "auth.authRequired": { en: "authentication required", es: "se requiere autenticación" },

  "llm.unknownProvider": { en: "unknown provider", es: "proveedor desconocido" },
  "llm.modelNotAllowed": {
    en: "model not allowed for this provider",
    es: "modelo no permitido para este proveedor",
  },
  "llm.apiKeyRequired": {
    en: "API key required for this provider",
    es: "API key requerida para este proveedor",
  },
  "llm.baseUrlRequired": { en: "Base URL required", es: "Base URL requerida" },
  "llm.cursorApiKeyConfigured": { en: "CURSOR_API_KEY configured", es: "CURSOR_API_KEY configurada" },
  "llm.cursorCliNotConfigured": { en: "Cursor CLI not configured", es: "Cursor CLI no configurado" },
  "llm.cursorCliReady": { en: "Cursor Agent CLI ready", es: "Cursor Agent CLI listo" },
  "llm.cursorCliInstallHint": {
    en: "Install Cursor Agent or run 'agent login' ({cliBin})",
    es: "Instala Cursor Agent o ejecuta 'agent login' ({cliBin})",
  },

  "plan.goalTooLong": {
    en: "goal exceeds the maximum allowed ({max})",
    es: "goal excede el máximo permitido ({max})",
  },
  "plan.invalidProject": { en: "invalid project", es: "project inválido" },
  "plan.assistV2Disabled": { en: "assist v2 disabled", es: "assist v2 deshabilitado" },
  "plan.internalError": { en: "internal error generating plan", es: "Error interno al generar plan" },

  "run.alreadyFinished": { en: "run already finished", es: "run ya finalizó" },
  "run.createFailed": { en: "could not create run", es: "no se pudo crear run" },
  "run.projectRequired": { en: "project is required", es: "project requerido" },
  "run.invalidCodeHints": { en: "invalid codeHints", es: "codeHints inválido" },
  "run.invalidAssisted": { en: "invalid assisted", es: "assisted inválido" },
  "run.invalidAssist": { en: "invalid assist", es: "assist inválido" },
  "run.notFound": { en: "run not found", es: "run no encontrado" },

  "assist.emptyLlmResponse": { en: "empty LLM response", es: "Respuesta LLM vacía" },
  "assist.planTimeout": { en: "timeout generating assisted plan", es: "Timeout al generar plan asistido" },
  "assist.planGenerationFailed": {
    en: "could not generate assisted plan",
    es: "No se pudo generar plan asistido",
  },
  "assist.planProcessingError": {
    en: "error processing assisted plan response",
    es: "Error al procesar respuesta del plan asistido",
  },
  "assist.invalidPlan": { en: "plan invalid per guardrails", es: "Plan inválido según guardrails" },
  "assist.targetUnreachable": {
    en:
      "Could not reach the app at {baseUrl}. The app under test is not responding (is it running?). " +
      "This is an issue with the target environment, not Ghostly.",
    es:
      "No se pudo alcanzar la aplicación en {baseUrl}. La app bajo prueba no responde (¿está levantada?). " +
      "El problema es del entorno objetivo, no de Ghostly.",
  },
} as const;

export type ApiMessageKey = keyof typeof messages;
