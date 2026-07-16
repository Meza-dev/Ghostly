# Tracker — Ghostly v0.2 "Trust Release"

> Histórico y estado único de TODO el trabajo de v0.2, como checklist por área.
> **Triage de cosas nuevas:** ¿compromete "Ghostly nunca miente"? → v0.2 · ¿capacidad nueva/mejora? → v0.3+
> Última actualización: 2026-07-10

## 🏁 ESTADO: v0.2 CERRADA (funcionalidad/back)

El corazón "Trust" está **construido, arreglado y probado**: 3 capas + healer v2 + los 11 hallazgos del testing en vivo, todo en `main`. La fiabilidad del motor (#1–#11) está completa. Barrido cruzado (Engram + docs + Kanon) confirma que **nada estructural quedó afuera**.

**Fuera de v0.2 por decisión explícita:** Fase 5 (modo CI → v0.3) · seguridad (track aparte, siguiente) · rediseño/UX (track aparte).

**Residual v0.2 diferido a "verificación continua" (no bloquea el cierre):**
- E1 — validar `inconclusive-environment` en vivo (opcional; el sistema ya maneja bien los errores de red)
- Benchmark con juez LLM real (medición de precisión, no de cableado — roadmap `5f674ae3`)
- 2 restos hardcode del healer (`MODAL_LOADER_TEXT_PATTERNS`, `victoryTargetVisible` en pipeline.ts) — deuda menor

**Próximo:** seguridad → (otro día) rediseño.

---

## 1. Núcleo v0.2 (las 3 capas + soporte)

- [x] Spec v0.2 escrita y aprobada (`docs/specs/ghostly-v0.2-trust-release.md`)
- [x] **Benchmark de fiabilidad creado** (app fixture propia + flows etiquetados + oráculos deterministas de juez/healer) — hoy 20 archivos / 165 tests + 1 todo
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
- [x] **F1 — navegación multi-página + selectOption + persistencia → `success` en vivo** (validó #9/#10/#3 con goal fresco, no replay)
- [ ] E1 — validar `inconclusive-environment` (opcional; verificación continua)
- [ ] F2 — ida y vuelta multi-pantalla → **descartado** (F1-fresco ya cubre 2 páginas con dependencia)
- [ ] Benchmark con **juez LLM real** (hoy solo oráculo determinista — gap spec §7 → roadmap `5f674ae3`)

## 5. Hallazgos del testing (ledger) — 11/11 resueltos o triageados

- [x] #7 — Juez terminal sin evidencia histórica → main (PR #17, validado en vivo)
- [x] #3 — Victoria limpia dejaba `verdict = null` → main (PR #18)
- [x] #5 — Falso "click sin mutación" (huella 1200 chars) → main (PR #18)
- [x] #8 — App caída = error crudo → mensaje claro → main (PR #20)
- [x] #9 — Verbos faltantes (`<select>`) → selectOption en main (PR #22), F1 desbloqueado
- [x] #1 — Persistencia fallida ahora va al juez (no hard-map) → main (PR #23)
- [x] #10 — Double-check recargaba baseUrl y perdía sesión/página → main (PR #23), validado en vivo (F1 `success`)
- [x] #6 — `healing-exhausted` converge al juez (1 replan por paso) → main (PR #24), unit-test + gate
- [x] #11 — Modal se cierra post-fill, healer no recupera → **cubierto por #6** (su síntoma)
- [ ] ⏸️ #2 — Victoria matchea texto tipeado en inputs → track de diseño (la condición de victoria puede mutar a "pistas")
- [ ] ⏸️ #4 — Placeholder sugiere toast como victoria → track de diseño

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
- [x] Backlog de verbos estructurado y persistido (Engram #435) + issues Kanon GHOST-41…47
- [x] Kanon: GHOST-37…40 pasados a done + issues del backlog de verbos creados
- [x] Deuda anotada: unificar los 3 `coerceStep` en un módulo
- [ ] `pnpm typecheck` roto en `@ghostly-io/scanner` (pre-existente en main, ajeno a v0.2) — arreglar o excluir
- [ ] Higiene Kanon: epic **GHOST-17 "parametrización"** quedó `in_progress` (fase-1 done, fase-2 backlog) — es un track aparte, no v0.2; marcar bien

## 10. Cola de merges — TODO MERGEADO ✅

- [x] PR #6, #16, #18, #20, #21, #22, #23 (#10+#1), #24 (#6) — **11 PRs mergeados a main en la jornada**

---

## Barrido cruzado (Engram + docs + Kanon) — 2026-07-10

Confirmado que no quedó nada de v0.2 por las grietas. Lo abierto en las 3 fuentes está correctamente fuera de v0.2:
- **Fase 5** → GHOST-33/34 (backlog, v0.3)
- **Verbos** → GHOST-41…47 (backlog, v0.3)
- **Roadmap** → observabilidad/optimización cerebros, iframes, multi-tab, MCP fases 1-3, hosted multi-user, onboarding, testing backend/API, benchmark con IA real, diagnóstico de fallo del proveedor IA (`9509b6b1`), etc. → todo v0.3+
- **Epic GHOST-17** (parametrización) → in_progress, track aparte

## v0.2 CERRADA → próximo: SEGURIDAD → (otro día) rediseño

Seguridad es track propio (ver `docs/security-audit-2026-07.md`, gitignoreado): **3 CRÍTICOS confirmados explotables** (C1 RCE por command injection en `spawn`, C2 forja de token admin por JWT default, C3 lectura de archivos sin auth) que se **encadenan en compromiso total sin autenticación**, + H1 SSRF + Parte II superficie agéntica (IA-1…4: prompt injection indirecto, provider CLI, MCP, replay de memoria).
