# Tracker — Ghostly v0.2 "Trust Release"

> **Qué es este documento:** el histórico y estado ÚNICO de todo lo que compone la v0.2 — lo hecho, lo en curso y lo pendiente — para saber cuánto falta y triagear lo nuevo.
> **Regla de triage para cosas nuevas:** ¿compromete la promesa *"Ghostly nunca miente"* (veredictos veraces)? → entra a v0.2. ¿Es capacidad nueva o mejora? → v0.3+.
> **Última actualización:** 2026-07-10.

Estados: ✅ hecho · 🚧 en curso · 📋 planificado (aprobado, sin arrancar) · ⏸️ pospuesto (decisión explícita) · ❓ sin decidir

---

## 1. Núcleo v0.2 — las fases de la spec (`docs/specs/ghostly-v0.2-trust-release.md`)

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Benchmark de fiabilidad + app fixture | ✅ (hoy 18 archivos / 155 tests) |
| 1 | Percepción (observer + `pageErrors`) | ✅ |
| 2 | Reglas duras (circuit breaker, victoria verificada + double-check, estancamiento) | ✅ |
| 3 | Juez (contrato runner + factory LLM real + 5 triggers) | ✅ |
| 4 | Persistencia de veredictos + dashboard (badges, why-panel) | ✅ |
| 5 | Operación desatendida (`ghostly run --ci`, exit codes, JUnit/JSON, scheduler) | ⏸️ pospuesta por decisión (recortable según spec §8) |

## 2. Evolución del healer (H0–H7, `docs/specs/ghostly-v0.2-healer-evolution.md`)

| Ítem | Estado |
|---|---|
| H0–H7 completos (benchmark, pageErrors, gate de ancla, prompt adelgazado, hint del juez, borrado de hardcodeos, applyStepFilters, stateChangedByHeal) | ✅ (PRs #11–#15, en main) |
| Restos menores: `MODAL_LOADER_TEXT_PATTERNS` y `victoryTargetVisible` en pipeline.ts | 📋 slice de limpieza futuro |
| Doc del healer con banner corregido | 🚧 PR #6 abierto, falta merge |

## 3. Validación en vivo (playground) — 2026-07-10

| Test | Qué validó | Resultado |
|---|---|---|
| A1 | Double-check atrapa falso éxito (edición sin guardar) | ✅ (y originó hallazgos #1, #2) |
| A1-bis | Victoria real verificada + persistencia | ✅ `success` |
| B1 | Circuit breaker ante 500 + evidencia + healer se abstiene | ✅ `fail-app-bug` |
| B2 | 200 mentiroso (non-persisting) sin falso éxito | ✅ `fail-app-bug` |
| C1 | Modal bloqueante resuelto genérico (strategist) | ✅ `success` |
| C1-bis | Healer LLM real: abstención correcta, cede al juez | ✅ (y originó #5, #6) |
| D1 | Juez: 3 triggers (error-signal, stalled, budget) + continue/hint + terminal | ✅ maquinaria; clasificación en zona gris (aceptado) |
| D2 | Juez distingue responsables → `fail-test-broken` | ✅ confianza alta, 1 invocación |
| E1 / E1-bis | `inconclusive-environment` | ❌ **no validado** — app caída pre-run cae fuera de taxonomía (hallazgo #8) |
| F1 | Navegación 2 páginas + relación Cliente→Pedido | 🚧 navegación ✅, bloqueado por `<select>` (#9) — **re-testear al mergear T1** |
| F2 | Ida y vuelta multi-pantalla | 📋 bloqueado por lo mismo |
| Veredictos cubiertos | success, fail-app-bug (×2 vías), fail-test-broken, fail-agent-lost, inconclusive | 5 de 6 (falta `inconclusive-environment`) |

## 4. Ledger de hallazgos del testing en vivo

| # | Hallazgo | Estado |
|---|---|---|
| #1 | `persistence-check-failed` hard-mapea a `fail-app-bug` sin juez (contamina la métrica clave) | 📋 aprobado — **1º slice post-T1** (rápido: reusa invokeJudge) |
| #2 | Victoria por texto matchea valores tipeados en inputs | ⏸️ revisión de victoria (futura) |
| #3 | Victoria limpia dejaba `verdict = null` | ✅ hecho — en PR #18 (falta merge) |
| #4 | UX: placeholder sugiere toast como victoria (siempre falla revalidación) | ⏸️ pasada de diseño (hint de UI en stash `ui-victory-hint-new-run-modal`) |
| #5 | Falso "click sin mutación" (huella de 1200 chars) | ✅ hecho — en PR #18 (falta merge) |
| #6 | `healing-exhausted` saltea al juez si el replan produce pasos | 📋 aprobado — **2º slice post-T1** (plan: 1 replan por paso → juez; requiere fixture "strategist testarudo") |
| #7 | Veredicto terminal perdía los pageErrors históricos | ✅ **en main** (PR #17, validado en vivo) |
| #8 | App caída al arranque = error crudo (fase plan fuera de taxonomía) | ✅ hecho — mensaje claro en PR #20 (falta merge) |
| #9 | Vocabulario de verbos incompleto (`<select>` imposible) | 🚧 T0+T1 hechos, gate de T1 corriendo → PR único a main |

## 5. Vocabulario de acciones (#9 desglosado)

| Unidad | Verbo(s) | Estado |
|---|---|---|
| T0 | Fundación: schema 5 verbos + guard anti-no-op + coerceStep ×2 + dedup | ✅ gate PASS (153+9 tests) |
| T1 | `selectOption` (único+múltiple) — desbloquea F1 + fix 3er coerceStep + bug raíz `hasEquivalentReplacementStep` | 🚧 hecho, gate corriendo |
| T2 | `check`/`uncheck` idempotentes | 📋 backlog Kanon |
| T3 | `setInputFiles` (sandbox-only, política decidida) | 📋 backlog Kanon |
| T4 | `hover` (patrón hover+waitForSelector) | 📋 backlog Kanon |
| T5 | Paridad memoria/replay + docs | 📋 backlog Kanon |
| Ronda 2a | dblclick, dragTo, scroll, slider | 📋 backlog Kanon |
| — | Diálogos nativos (confirm/alert — hoy cuelgan el paso) | 📋 backlog Kanon |
| — | Iframes / multi-pestaña | 📋 roadmap, specs propias |
| Regla grabada | Por cada verbo: caso en benchmark + control en playground + cableado completo | (obs Engram #435) |

## 6. Deuda técnica y pendientes varios

| Ítem | Estado |
|---|---|
| Unificar los 3 `coerceStep` (orchestrator, assist-plan, saneo healer) | 📋 anotado post-T1 |
| Prompt de `/v1/plan` no menciona `selectOption` (inerte para el plan inicial) | 📋 flag de T1, diferido |
| Benchmark con **juez LLM real** (mide precisión de clasificación, no solo cableado) | 📋 futuro (gap de spec §7) |
| Relevamiento completo de controles HTML soportados | ✅ hecho (tabla en sesión 2026-07-10, base del backlog de verbos) |
| Kanon caído: crear issues del backlog de verbos + mover GHOST-37..40 a done | 📋 cuando Kanon vuelva |
| Auditoría de seguridad 2026-07: 3 CRÍTICOS encadenables (JWT default, spawn, rutas estáticas sin auth) — ¿parcheados? | ❓ **sin verificar** — el doc está gitignoreado, los fixes no se confirmaron |
| Pasada de diseño del front (condición de victoria, modal nueva ejecución) | ⏸️ pedida por el usuario, sin fecha |

## 7. PRs abiertos (cola de merge)

| PR | Contenido | Estado |
|---|---|---|
| #6 | Doc evolución del healer (banner corregido) | abierto |
| #18 | Fixes #3 + #5 (verdict success + huella completa) | abierto |
| #20 | Fix #8 (mensaje "tu app no responde") | abierto |
| (próximo) | T0+T1 verbos (`feat/action-vocabulary`) | al pasar el gate de T1 |

## 8. Criterios de cierre de v0.2 (foto actual)

| Criterio (spec §8) | Estado |
|---|---|
| 1. Benchmark: veredictos veraces, cero falsos éxitos | ✅ (16 flows verdes; falsos éxitos detectados en vivo = 0 tras fixes) |
| 2. 500 al guardar corta con evidencia | ✅ validado en vivo (B1) |
| 3. Guardado que no persiste ≠ success | ✅ validado en vivo (A1, B2) |
| 4. Modal → run se completa | ✅ validado en vivo (C1) |
| 5. Memoria solo con doble confirmación | ✅ (guardia implementada; validación indirecta) |
| 6. Dashboard muestra veredicto + por qué | ✅ (con fix #3 pendiente de merge para victorias limpias) |
| 7. `ghostly run --ci` con exit codes | ⏸️ pospuesto con la Fase 5 |

**Lectura honesta:** el corazón "Trust" está hecho y validado en vivo; para declarar v0.2 cerrada faltan: merge de los 3 PRs + T0/T1, los slices #1 y #6 (calidad de veredicto), re-test F1/F2, y decidir si la Fase 5 entra o se va a v0.3.
