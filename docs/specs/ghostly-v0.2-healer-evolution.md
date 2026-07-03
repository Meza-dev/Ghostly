# Diseño — Evolución del Healer hacia v0.2 "Trust Release"

> **Estado:** análisis de diseño (2026-07-03). No implementado. Complementa `ghostly-v0.2-trust-release.md`.
> **Principio rector heredado de v0.2:** _la IA propone, el motor verifica._ Aplicado al healer: propone correcciones de plan, pero el motor confirma que sean reales y el juez decide el desenlace cuando el healer no puede.

---

## 1. Propósito y alcance

Este documento captura el análisis de cómo dejar el **healer** de Ghostly en su mejor forma, aprovechando la arquitectura de tres capas de la v0.2 Trust Release. No es un spec de implementación cerrado: es la base de diseño para una futura tarea (candidata a fase 3+ de v0.2 o posterior).

**No-meta:** rediseñar el strategist ni el juez. Solo el healer y sus fronteras con las otras capas.

---

## 2. Rol del healer (recordatorio)

El healer es el mecanismo de **auto-sanación** de Ghostly. Cuando el agente se pierde porque **no encuentra un botón, un input, un texto, etc.**, el healer revisa el estado real de la página, analiza el error y **modifica el plan** para desbloquear la acción — sin que el usuario tenga que arreglar nada a mano. Esa es la promesa del producto: se autosana.

Su dominio real y acotado es la **percepción/selección**: "el ancla que buscaba no está donde esperaba; encontrá el ancla correcta o el paso previo que la hace aparecer".

---

## 3. Arquitectura actual (as-is)

El healer vive hoy en tres piezas, con la separación de responsabilidades correcta (puerto en el runner, adaptador con LLM en el API):

### 3.1 Contrato + saneo determinista — `packages/runner/src/assist/healer.ts`
- `sanitizeHealerSteps(baseUrl, proposed, maxTimeoutMs)`: recorta a **máx 3 pasos**, descarta selectores **ambiguos** (`button`, `input[type=submit]`, `form button`, etc. — set `AMBIGUOUS_HEALER_SELECTORS`), descarta selectores basados en `[ref=eN]` (índices efímeros del snapshot a11y), fuerza **mismo origin** vía `safeParseRunInput`. Si el parseo falla, devuelve `[]`.
- Tipos re-exportados desde `types.ts`.

### 3.2 Implementación con LLM — `apps/api/src/services/assist-orchestrator.ts`
- `HEALER_SYSTEM`: prompt de sistema monolítico (array de reglas en español), con instrucciones para desambiguar por id/name/aria-label, cerrar overlays, no repetir el paso fallido, etc.
- `buildHealerUserPrompt(ctx)`: arma el prompt de usuario con objetivo, paso fallido, error truncado, historial (últimos 8), `buildSelectorFatigueHint` (selector que ya falló 2+ veces), pistas de modales y `codeHints`.
- `createHealer(opts)`: llama al LLM (`callLlmJson`), y pasa la salida por una **cadena de filtros anidados** antes de devolver `HealerResult`.

### 3.3 Invocación — `packages/runner/src/assist/pipeline.ts`
- El motor primero agota su **expansión determinista de selectores** (`tryWithSelectorFallbacks`: un selector base se expande a varios candidatos —role/placeholder/textbox— y se prueba cada uno). **Solo cuando todos fallan**, `applyStep` lanza.
- Ahí entra el `catch`: se emite `step_failure` y se corre el bucle de sanación `for (attempt = 1..healingAttempts)` (`maxHealingAttemptsPerStep`, default 1).
- Por cada intento: snapshot fresco → `heal_start` → `deps.healer(ctx)` → `sanitizeHealerSteps` → ejecutar cada `healStep` → recapturar snapshot → decidir si el paso original se reintenta o se salta (`hasEquivalentReplacementStep`, `stateChangedByHeal`, varios `shouldDrop*`) → `heal_success` / `heal_failure`.
- Guardas de idempotencia: `hasSuccessfulHistoryStep` evita re-ejecutar pasos ya OK; `pushLearnedStep`/`runtimeMemory` acumulan lo aprendido.

---

## 4. Diagnóstico

### 4.1 Fortalezas (mantener)
- **Separación puerto/adaptador limpia**: el runner nunca importa un LLM; el healer es testeable sin IA.
- **Defensa en profundidad**: la salida del LLM se sanea dos veces (filtros del API + `sanitizeHealerSteps` del runner). El motor tiene la última palabra sobre lo que se ejecuta.
- **Observabilidad seria**: eventos `heal_start/heal_action/heal_success/heal_failure` + `debugLog`.
- **Idempotencia**: no repite pasos ya exitosos.

### 4.2 Problemas
1. **Conocimiento de apps concretas incrustado en el motor genérico.** Filtros y prompt tienen reglas hardcodeadas de aplicaciones específicas: `filterSidebarNavWhenCalificacionModalOpen`, `filterMisleadingCloseForCalificacionCreateFlow`, `buildCreateTripModalSemanticHint`, y literales como `"Crear grupo"`, `"Calificaciones del grupo"`, `"Crear Nuevo Viaje"`, `#conductorId`, `remitos`, el widget de Google Maps. No escala: cada app nueva tienta otro `filterXWhenYModalOpen`.
2. **Prompt monolítico y frágil.** `HEALER_SYSTEM` es un muro de reglas que se solapan; difícil de testear, caro en tokens, imposible de verificar por partes.
3. **Composición de filtros ilegible y duplicada.** Cinco filtros anidados como argumentos en `createHealer`, y el mismo stack repetido en `createStrategist`.
4. **El healer no distingue "estoy perdido" de "la app está rota"** (ver §5). Es la falla conceptual de fondo.

---

## 5. El insight central

El healer HOY sufre el problema que la v0.2 resuelve para el resto del pipeline: **no puede distinguir su propio dominio del que no le corresponde.**

Su rol es el caso "estoy perdido": no encuentra el botón/input/texto → corrige el plan. Pero hoy se dispara ante **cualquier** `throw` de `applyStep` y trata todo como problema de selector. Si "Guardar" no aparece porque la app tiró un **500**, el healer propone selectores alternativos a ciegas — sanando algo que no tiene cura. Eso quema intentos y empuja hacia un veredicto mentiroso.

v0.2 le da al healer, por primera vez, el **vocabulario para saber cuándo NO es su problema**: la Capa 1 (percepción) captura los errores que antes eran invisibles, y la Capa 3 (juez) se hace cargo del desenlace cuando el healer agota.

---

## 6. Patrones de v0.2 aplicables al healer (priorizados)

### P1 — Alimentar el healer con `pageErrors[]` de Capa 1 (máximo impacto)
El observer ampliado captura consola, red 4xx/5xx y alerts DOM estructurados (`PageError[]`, ver spec v0.2 §4.1). El `HealerContext` ya recibe el `snapshot`, pero el prompt no explota `pageErrors`. Regla nueva:
- Si el snapshot trae un `PageError` con `severity: "blocking"` correlacionado con el paso fallido → **el healer no debe sanar**; ese caso pertenece al circuit breaker (Capa 2) / juez (Capa 3).
- El healer actúa solo cuando el fallo es de **percepción/selector**, su verdadero dominio.

### P2 — El healer deja de cargar con el veredicto
En v0.2, `healing-exhausted` es un **trigger del juez**. Antes el healer era la última línea y tenía que "decidir rendirse", de ahí buena parte de sus reglas defensivas. Nuevo reparto:
- El healer **solo intenta desbloquear**.
- Cuando agota intentos, el **juez clasifica**: `fail-agent-lost` (Ghostly se perdió), `fail-app-bug` (la app está rota), `fail-test-broken` (el plan/condición estaba mal).
- Consecuencia práctica: **adelgazar `HEALER_SYSTEM`** — el healer ya no opina sobre el desenlace, solo propone la corrección.

### P3 — Gate determinista de existencia de selector ("el motor verifica")
`sanitizeHealerSteps` hoy rechaza ambiguos y `ref=`, pero **no verifica que el selector propuesto exista en el mapa observado**. Aplicando el principio rector (`evidencia determinista > LLM`):
- Si el healer propone `#guardarBtn` y ese nodo no aparece en el snapshot observado, **rechazarlo antes de reintentar**.
- Barato, determinista, elimina reintentos inútiles. El healer propone el ancla; el motor confirma que existe.

### P4 — Matar los filtros app-specific con percepción estructurada
Los `filter*Calificacion*`, `filter*CreateTrip*` y los substrings de dominio son **percepción hecha a mano**. La Capa 1 ya detecta diálogos/modales/overlays **estructuralmente**. El healer debe razonar sobre señales estructuradas ("hay un dialog abierto", "hay un overlay bloqueante") en vez de `goal.includes("calificación")`. v0.2 es la excusa para **borrar esas reglas hardcodeadas** y mover cualquier heurística residual a configuración/plugins por proyecto (nunca al core).

### P5 — Unificar el `hint` del juez con los pasos del healer
`JudgeVerdict.hint` (p. ej. _"hay un modal tapando el botón; cerralo primero"_) es exactamente lo que produce el healer. Hay solapamiento conceptual naciente. Definir la relación **ahora** para no terminar con dos LLMs y dos prompts gigantes haciendo lo mismo:
- El `hint` del juez (`verdict = "continue"`) alimenta al healer/strategist como contexto.
- El healer es el **actuador** de esa pista (traduce el hint a pasos ejecutables saneados).

### P6 — Usar `snapshotDiff` / `stateChangedByHeal` como realimentación
El pipeline ya computa `stateChangedByHeal`, pero no vuelve a la decisión del healer. Señal nueva:
- Si un intento de sanación **no cambió el estado** de la página, no repetir la misma clase de fix en el siguiente intento.
- Es más rico que `buildSelectorFatigueHint` (que solo mira el historial de selectores).

### P7 — Benchmark-first para el prompt del healer
v0.2 exige validar todo cambio de prompt contra el **benchmark de fiabilidad** (spec §7). Esto da la red de seguridad para refactorizar el prompt monolítico y borrar reglas app-specific **con evidencia, no a mano**. Escenarios del benchmark directamente relevantes al healer: modal de confirmación tapando el botón, toast efímero, validación que rechaza. Sin benchmark, tocar `HEALER_SYSTEM` es a ciegas.

---

## 7. Reglas de diseño resultantes (target)

El healer objetivo, en una frase: de **"reparador que adivina y carga con todo el desenlace"** a **especialista acotado**.

1. **Percibe con datos estructurados** (`pageErrors`, diálogos), no con substrings de dominio.
2. **Actúa solo en su dominio real** (selector/percepción); ante error bloqueante de app, se abstiene y cede a Capa 2/3.
3. **Es verificado por el motor** (existencia del ancla propuesta, no ambigüedad, mismo origin, máx 3 pasos).
4. **Delega el veredicto al juez** cuando agota; no clasifica el desenlace.
5. **Sin conocimiento de apps concretas** en el core; heurísticas residuales → config por proyecto.
6. **Prompt modular y medido** contra el benchmark.

---

## 8. Plan de cambios y orden de dependencias

El healer depende de capas de v0.2 que deben existir antes. Orden sugerido:

| Paso | Cambio | Depende de |
|---|---|---|
| H0 | Escenarios de healer en el benchmark (modal, toast, validación, 500-al-buscar-ancla) con ground truth | Fase 0 (benchmark) |
| H1 | El `HealerContext` transporta `pageErrors`; regla "no sanar si hay `blocking` correlacionado" | Fase 1 (percepción) ✅, Fase 2 (circuit breaker) ✅ |
| H2 | Gate determinista de existencia de ancla en `sanitizeHealerSteps` | Capa 1 (mapa observado) ✅ |
| H3 | Adelgazar `HEALER_SYSTEM`: quitar la lógica de "rendirse"/desenlace (la asume el juez) | Fase 3 (juez, trigger `healing-exhausted`) |
| H4 | Unificar `hint` del juez → contexto del healer; healer como actuador del hint | Fase 3 (juez) |
| H5 | Borrar filtros app-specific; mover heurística residual a config/plugins por proyecto | H1–H2 (percepción estructural cubre los casos) |
| H6 | Realimentar `stateChangedByHeal` a la decisión entre intentos | — |
| H7 | Unificar la cadena de filtros strategist/healer en un `applyStepFilters(steps, ctx)` con `reduce` | H5 |

**Nota:** H1, H2 y H6 ya son viables hoy (sus dependencias están `done`: GHOST-26/27/28). H3–H5 dependen del juez (GHOST-29 ✅ contrato/runner; GHOST-30 en curso, factory API).

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Adelgazar el prompt puede perder recuperaciones que hoy funcionan por casualidad | Cada recorte se valida contra el benchmark antes de mergear (P7) |
| El gate de existencia de ancla puede rechazar selectores válidos si el mapa observado está incompleto | El gate solo rechaza cuando el mapa es no vacío y el ancla claramente no está; ante mapa dudoso, dejar pasar y que el reintento real decida |
| Solapamiento healer/juez mal definido → doble trabajo o loops | Límite ya existente de intervenciones del juez por run + `hint` como contexto unidireccional hacia el healer |
| Borrar filtros app-specific puede regresionar los flujos que los motivaron | Reproducir esos flujos como escenarios del benchmark antes de borrar (red antes de saltar) |

---

## 10. Referencias

- **Spec base:** `docs/specs/ghostly-v0.2-trust-release.md` (tres capas, `pageErrors`, circuit breaker, victoria verificada, juez, taxonomía de 6 veredictos).
- **Código actual del healer:** `packages/runner/src/assist/healer.ts` (`sanitizeHealerSteps`); `apps/api/src/services/assist-orchestrator.ts` (`HEALER_SYSTEM`, `buildHealerUserPrompt`, `createHealer`, filtros); `packages/runner/src/assist/pipeline.ts` (`tryWithSelectorFallbacks`, bucle de sanación en el `catch`); `packages/runner/src/assist/types.ts` (`HealerContext`, `HealerResult`, `HealerFn`).
- **Engram:** `architecture/ghostly-healer-v2-evolution` (este análisis); `architecture/ghostly-v0.2-trust-release`; `architecture/ghostly-judge-agent`.
- **Board Kanon:** GHOST-25..28 ✅ done (benchmark, percepción, circuit breaker, victoria/stall); GHOST-29 ✅ done (contrato del juez, runner); GHOST-30 🔨 in_progress (factory del juez + guardia de memoria, API); GHOST-31..34 backlog.
