# Tracker — Ghostly v0.2 "Trust Release"

> Histórico y estado único de TODO el trabajo de v0.2, como checklist por área.
> **Triage de cosas nuevas:** ¿compromete "Ghostly nunca miente"? → v0.2 · ¿capacidad nueva/mejora? → v0.3+
> Última actualización: 2026-07-10

---

## 1. Núcleo v0.2 (las 3 capas + soporte)

- [x] Spec v0.2 escrita y aprobada (`docs/specs/ghostly-v0.2-trust-release.md`)
- [x] **Benchmark de fiabilidad creado** (app fixture propia + flows etiquetados + oráculos deterministas de juez/healer) — hoy 18 archivos / 155 tests
- [x] Capa 1 — Observer ampliado: `pageErrors` (consola + red 4xx/5xx + alerts DOM)
- [x] Capa 2 — Circuit breaker de errores bloqueantes
- [x] Capa 2 — Victoria verificada + double-check de persistencia
- [x] Capa 2 — Detector de estancamiento
- [x] Capa 3 — Contrato del juez + dossier + 5 triggers (GHOST-29)
- [x] Capa 3 — Factory del juez con LLM real + gating de imágenes (GHOST-30)
- [x] Persistencia de veredictos + RunEvents (GHOST-31)
- [x] Dashboard: badges de veredicto + why-panel + eventos del juez (GHOST-32)
- [x] Boundary único de redacción de secretos (GHOST-35)
- [x] Guardia de memoria: AssistMemory solo con doble confirmación
- [ ] ⏸️ Fase 5 — modo CI (`--ci`, exit codes, JUnit/JSON) + scheduler → **decidir: ¿v0.2 o v0.3?**

## 2. Healer v2

- [x] Doc de evolución del healer escrito (H0–H7)
- [x] H0 — Escenarios de healer en el benchmark (`testOracleHealer`)
- [x] H1 — `pageErrors` al healer + "no sanar errores de app"
- [x] H2 — Gate determinista de existencia de ancla
- [x] H3 — `HEALER_SYSTEM` adelgazado (cede el desenlace al juez)
- [x] H4 — Hint del juez → contexto del healer
- [x] H5 — Borrados los hardcodeos de dominio (Calificación/Viaje/Maps)
- [x] H6 — `stateChangedByHeal` realimenta entre intentos
- [x] H7 — Cadena unificada `applyStepFilters`
- [x] healer-v2 mergeado a main (PR #15) + limpieza de 10 PRs zombies y 15 ramas
- [ ] Limpiar restos: `MODAL_LOADER_TEXT_PATTERNS` + `victoryTargetVisible` (pipeline.ts)
- [ ] Mergear PR #6 (doc del healer, banner ya corregido)

## 3. Playground (app de prueba)

- [x] **Playground creado** (React+Vite, login, Clientes ABM, Pedidos con relación cliente→pedido, `data-testid` en todo)
- [x] Panel de fallas: fail-on-save (500), non-persisting-save, validation-rejects, blocking-modal, slow + Reset
- [x] Sesión persistida en localStorage
- [ ] Agregar controles para verbos futuros: checkbox, upload, menú hover (regla: 1 control por verbo nuevo)
- [ ] (opcional) Toggle de 422 con mensaje honesto — para que D1 tenga ground truth inequívoco

## 4. Validación en vivo (2026-07-10)

- [x] A1 — double-check atrapa falso éxito
- [x] A1-bis — `success` real verificado
- [x] B1 — circuit breaker + `fail-app-bug` con evidencia 500
- [x] B2 — 200 mentiroso sin falso éxito
- [x] C1 — modal bloqueante resuelto genérico
- [x] C1-bis — healer LLM real: abstención + cede al juez
- [x] D1 — juez: 3 triggers + continue/hint + terminal (zona gris aceptada)
- [x] D2 — juez distingue responsables (`fail-test-broken`, confianza alta)
- [x] Modelo LLM cambiado a grok-4.5-xhigh (~3x más rápido que composer)
- [ ] E1 — validar `inconclusive-environment` (requiere matar server con timing quirúrgico)
- [ ] F1 — re-testear al mergear PR #22 (navegación ✅, quedó bloqueado por `<select>`)
- [ ] F2 — ida y vuelta multi-pantalla (mismo bloqueo)
- [ ] (opcional) forzar `fail-agent-lost` limpio: quitar un data-testid a propósito
- [ ] Benchmark con **juez LLM real** (hoy solo oráculo determinista — gap spec §7)

## 5. Hallazgos del testing (ledger)

- [x] #7 — Juez terminal sin evidencia histórica → **en main** (PR #17, validado en vivo)
- [x] #3 — Victoria limpia dejaba `verdict = null` → hecho, en PR #18
- [x] #5 — Falso "click sin mutación" (huella 1200 chars) → hecho, en PR #18
- [x] #8 — App caída = error crudo → mensaje claro hecho, en PR #20
- [ ] #1 — Persistencia fallida debe ir al juez (no hard-map a `fail-app-bug`) — **1º slice post-#22**
- [ ] #6 — `healing-exhausted` → juez (1 replan por paso; requiere fixture "strategist testarudo") — **2º slice post-#22**
- [ ] ⏸️ #2 — Victoria matchea texto tipeado en inputs → revisión de victoria
- [ ] ⏸️ #4 — Placeholder sugiere toast como victoria → pasada de diseño
- [x] #9 — Verbos faltantes → T0+T1 hechos con 2 gates PASS → **PR #22 abierto**

## 6. Vocabulario de acciones (#9)

- [x] Relevamiento completo: controles HTML vs soporte de Ghostly (tabla 2026-07-10)
- [x] SDD completo: propuesta + spec + design + tasks (Engram #426–429, gate adversarial de design PASS)
- [x] T0 — Fundación: schema 5 verbos, guard anti-no-op, coerceStep ×2, dedup — **gate PASS**
- [x] T1 — `selectOption` + fix 3er coerceStep + bug raíz `hasEquivalentReplacementStep` — **gate PASS**
- [ ] **Mergear PR #22** (T0+T1, ~637 líneas, size:exception documentado)
- [ ] Benchmark de multi-select con valor array (sugerencia del gate — el código lo soporta, falta cobertura directa)
- [ ] Enseñar `selectOption` al prompt de `/v1/plan` (hoy inerte en el plan inicial; va con T4/T5)
- [ ] T2 — `check`/`uncheck` idempotentes → backlog
- [ ] T3 — `setInputFiles` sandbox-only (política decidida) → backlog
- [ ] T4 — `hover` (patrón hover+waitForSelector) → backlog
- [ ] T5 — paridad memoria/replay + docs → backlog
- [ ] Ronda 2a — dblclick, dragTo, scroll, slider → backlog
- [ ] Diálogos nativos (confirm/alert — hoy cuelgan el paso) → backlog
- [ ] Iframes → spec propia (roadmap)
- [ ] Multi-pestaña/popup → spec propia (roadmap)

## 7. Diseño / UX (pasada pendiente pedida por el usuario)

- [ ] Rediseño general del front ("vamos a cambiar muchas cosas de diseño")
- [ ] Rediseñar la UI de condición de victoria (no convence cómo se ve/explica)
- [ ] Decidir el hint de victoria agregado hoy (está en stash `ui-victory-hint-new-run-modal`, sin commitear)
- [ ] Exponer `revalidate: false` en la UI (el schema lo soporta, el modal no)
- [ ] #4 — corregir placeholder de "Texto esperado" (sugiere un toast, que siempre falla revalidación)

## 8. Seguridad

- [x] Repo público: docs sensibles gitignoreados (`security-audit-2026-07.md`, `docker-deployment.md`) — PR #16
- [x] Redacción de secretos validada en vivo (user/pass → `[REDACTED]` en logs y persistencia)
- [x] `setInputFiles` diseñado sandbox-only (el LLM nunca toca rutas arbitrarias del disco)
- [ ] ⚠️ **Verificar/parchear los CRÍTICOS de la auditoría 2026-07**: JWT secret con default público · `spawn` confiando en input del usuario · rutas estáticas que esquivan auth · endpoint LLM sin validar destino (SSRF) — **sin confirmación de fix, repo público**
- [ ] Confirmar merge de PR #16 (gitignore)

## 9. Proceso / herramientas

- [x] Tracker v0.2 creado (este doc, PR #21)
- [x] Backlog de verbos estructurado y persistido (Engram #435)
- [x] Deuda anotada: unificar los 3 `coerceStep` en un módulo
- [ ] Kanon caído: al volver, crear issues del backlog de verbos + pasar GHOST-37..40 a done
- [ ] `pnpm typecheck` roto en `@ghostly-io/scanner` (pre-existente en main, ajeno a v0.2) — arreglar o excluir

## 10. Cola de merges (hoy)

- [ ] PR #6 — doc healer
- [ ] PR #18 — fixes #3 + #5
- [ ] PR #20 — fix #8
- [ ] PR #21 — este tracker
- [ ] PR #22 — verbos T0+T1 (gates PASS)
- [ ] Confirmar PR #16 — gitignore seguridad

---

## Para cerrar v0.2 (lista corta)

1. Mergear la cola (sección 10)
2. Slice #1 → slice #6
3. Re-test F1/F2 + validar E1
4. Decidir Fase 5 (¿v0.3?)
5. Verificar críticos de seguridad (sección 8 — o declararlos explícitamente fuera de v0.2)
