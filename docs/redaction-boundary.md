# Boundary de redacción de texto libre

**Estado**: ✅ Implementado (Kanon GHOST-35, spec §6 hardening).

## Por qué existe

GHOST-31 (persistencia de veredictos del juez) leakeó secretos 3 veces
seguidas (C1: `goal`, C2: `hint`, C3: `verdictReason`) porque la redacción se
aplicaba por sink, no en un único punto. Cada slice nueva que agregaba un
sink de persistencia tenía que "acordarse" de redactar su propio texto libre
— eso garantiza leaks recurrentes, no mala suerte. Ver la retrospectiva
completa (Engram `ghostly/v0.2-retrospective-redaction-gap`).

## El contrato

`packages/runner/src/assist/redaction.ts` es el ÚNICO choke point de
redacción de texto libre del proyecto:

- `redactOrTruncateText(value: string): string` — redacta el valor completo
  a `"[REDACTED]"` si contiene una palabra sensible (`SENSITIVE_TEXT_WORDS`:
  password, token, secret, api key, authorization, etc.); si no, lo trunca a
  1000 caracteres.
- `redactOrTruncateList(values: string[]): string[]` — aplica lo anterior a
  cada entrada de un array (p. ej. `evidence`).
- `SENSITIVE_TEXT_WORDS` — la lista de palabras, exportada como fuente única
  de verdad.

Re-exportado desde `packages/runner/src/assist/judge.ts` (compat con
imports existentes) y desde el índice público del paquete
(`@ghostly-io/runner`), así que `apps/api` lo consume directamente —
`apps/api/src/lib/redact-assist.ts` NO mantiene su propia copia de la
lista de palabras, importa la función real del paquete compilado.

**No es un tipo `Redacted<T>` forzado por el compilador a propósito** —
esta slice es deliberadamente ligera: un choke point documentado + una
auditoría exhaustiva de sinks (ver más abajo), no un wrapper de tipos nuevo
que agregaría fricción en cada call site sin más seguridad real.

## Regla para código nuevo

**Todo texto libre que salga del runner hacia un evento (`emit`), la
respuesta de `AssistedRunResult`, o cualquier campo que `apps/api` vaya a
persistir/exponer, DEBE pasar por `redactOrTruncateText`/`redactOrTruncateList`
antes de salir** — aplicado en el punto donde el valor SALE del pipeline
(el patrón "choke point en la fuente" del fix C3), no en cada consumidor
downstream. Esto es válido para:

- Texto interpolado del `goal` del usuario.
- `reasoning`/`hint`/`rationale` autorados por el juez o el healer (LLM).
- Mensajes de página (`PageError.message` — consola, DOM, red) y mensajes
  de excepción de Playwright/JS.

Campos de tipo enum/taxonomía cerrada (`verdict`, `stopReason`,
`JudgeConfidence`) NO necesitan redacción — son seguros por construcción.

## Sinks auditados

La tabla completa de sinks conocidos (con evidencia de test por cada uno,
usando un token secreto plantado — no una comparación tautológica contra
`"[REDACTED]"`) vive en
`packages/runner/src/assist/__tests__/redaction-boundary-audit.test.ts`.
Extenderla es obligatorio cuando se agregue un `emit(...)` nuevo con un
campo de texto libre.
