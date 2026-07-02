# Spec — Ghostly v0.2 "Trust Release"

> **Estado:** diseño aprobado (2026-07-02). Listo para bajar a tareas de implementación.
> **Principio rector:** _la IA propone, el motor verifica._ El objetivo de esta versión no es que Ghostly falle menos: es que **nunca mienta**. Cada run debe terminar con un veredicto veraz — éxito real comprobado, o fallo bien clasificado y explicado.

---

## 1. Contexto y problema

Ghostly hoy (v0.1/MVP) ejecuta flujos asistidos sobre páginas simples, pero en pruebas reales **~4 de cada 10 runs terminan con un resultado incorrecto**. Los dos modos de fallo observados:

1. **No corta ante un error evidente.** La app muestra un error claro (banner, 500, validación) y el agente sigue intentando llegar al objetivo hasta agotar `maxLoopMs`/`maxHorizons`, en lugar de abortar e informar la causa.
2. **Falso éxito.** El agente declara el objetivo cumplido cuando no lo está (p. ej. formulario lleno pero nunca persistido).

### Causas raíz (diagnóstico verificado en código)

| # | Causa | Evidencia |
|---|---|---|
| 1 | El observer no captura errores: ni consola, ni respuestas 4xx/5xx, ni clasificación de banners/toasts/`role="alert"`. Si el error no aparece en el árbol de accesibilidad, la IA no lo ve. | `packages/runner/src/assist/observer.ts` |
| 2 | El loop no tiene ningún camino de "abortar por error de la app". Sale solo por victoria, timeout o máximo de horizontes. | `packages/runner/src/assist/pipeline.ts` (`runAssistedFlow`) |
| 3 | El prompt del strategist (80+ líneas de reglas) no contiene ninguna regla del tipo "si ves un error, reportá fallo en vez de continuar". El LLM no tiene vocabulario para rendirse. | `apps/api/src/services/assist-orchestrator.ts` |
| 4 | La victoria se decide con heurísticas débiles de substring (`naturalLanguageVictorySatisfied`, `objectiveLikelyCompleted`) que pueden dar positivo sobre estado no persistido. | `pipeline.ts` (`evaluateVictory` y helpers) |
| 5 | El replay de memoria (`AssistMemory`) persiste pasos como "verdad" si el run dio `pass`, sin re-validar la victoria en el run actual. Un falso éxito se convierte en memoria envenenada que se replaya. | `apps/api/src/routes/run.ts` |
| 6 | `Run.status` solo distingue `pass \| fail \| running`. El `stopReason` interno existe pero no se persiste. El usuario no sabe POR QUÉ falló. | `apps/api/prisma/schema.prisma` |
| 7 | Cobertura de tests: solo sanitización del healer y formato del observer. Cero tests de escenarios de error o falso éxito. | `packages/runner/src/assist/__tests__/` |

### Definición de éxito de esta versión

**10 de 10 veredictos veraces** sobre el benchmark de fiabilidad (ver §7): cada run termina en éxito real comprobado o en fallo correctamente clasificado con evidencia. Un falso éxito es el peor defecto posible; un fallo mal clasificado es el segundo.

---

## 2. Metas y no-metas

### Metas

- **M1.** Capturar errores de página de forma estructurada (percepción).
- **M2.** Abortar determinísticamente ante errores bloqueantes, con evidencia (circuit breaker).
- **M3.** Victoria declarada SOLO por verificación del motor, con double-check de persistencia (victoria verificada).
- **M4.** Agente juez que clasifica el desenlace en la zona gris con taxonomía de 6 veredictos.
- **M5.** Estados de resultado ricos persistidos y visibles en el dashboard.
- **M6.** Memoria de replay protegida: solo se aprende de éxitos doblemente confirmados.
- **M7.** Benchmark de fiabilidad reproducible que mide el pipeline y al juez.
- **M8.** Operación desatendida mínima: modo CI y scheduling local (fase final).

### No-metas (explícitas, para no dispersar)

- Ejecución en la nube / SaaS (contradice local-first; no está en discusión).
- Paralelismo de runs.
- Visual regression testing.
- Testing de email/inbox.
- Soporte de navegadores no-Chromium.
- Colaboración multi-usuario en el dashboard.

---

## 3. Arquitectura: tres capas de veredicto

El corazón de la versión. Cada capa tiene una responsabilidad y una autoridad distinta:

```
┌─────────────────────────────────────────────────────────────┐
│ CAPA 1 — PERCEPCIÓN (observer ampliado)                     │
│ Captura TODO lo relevante: a11y tree, formularios, diálogos │
│ + errores de consola + red 4xx/5xx + alerts/toasts          │
│ Output: snapshot enriquecido con pageErrors[] estructurado  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ CAPA 2 — REGLAS DURAS (determinista, en el motor)           │
│ Lo obvio se decide por código: nunca miente, siempre        │
│ reproducible, costo cero en tokens.                         │
│ - Circuit breaker: error bloqueante tras acción → abortar   │
│ - Victoria verificada: URL/texto/elemento + double-check    │
│ - Detector de estancamiento: N pasos sin progreso (diff)    │
└──────────────────────────┬──────────────────────────────────┘
                           ▼ (solo zona gris)
┌─────────────────────────────────────────────────────────────┐
│ CAPA 3 — JUEZ (LLM, invocado por eventos)                   │
│ Clasifica lo que las reglas no alcanzan: modales,           │
│ errores ambiguos, semántica de "¿cumplió el objetivo?".     │
│ Output: veredicto estructurado + evidencia + pista opcional │
└─────────────────────────────────────────────────────────────┘
```

**Jerarquía de autoridad (regla de oro):** `evidencia determinista > juez > strategist`.
El juez nunca puede declarar éxito CONTRA un check determinista fallido. Solo interpreta donde la evidencia dura es ambigua. El strategist deja de opinar sobre el desenlace: propone pasos, nada más.

---

## 4. Especificación por capa

### 4.1 Capa 1 — Percepción (observer ampliado)

**Dónde:** `packages/runner/src/assist/observer.ts` + hooks de página en `pipeline.ts`.

El snapshot incorpora un campo nuevo estructurado:

```ts
type PageError = {
  source: "console" | "network" | "dom";
  severity: "blocking" | "warning";
  message: string;          // texto del error, truncado y redactado
  detail?: {
    url?: string;           // network: URL de la request fallida
    status?: number;        // network: 4xx / 5xx
    selector?: string;      // dom: dónde se encontró el alert/toast/banner
  };
  observedAtStep: number;   // índice del paso tras el cual se capturó
};

type ObserverSnapshot = {
  /* ...campos actuales (a11y, forms, dialogs, url, title)... */
  pageErrors: PageError[];
};
```

Fuentes de captura:

1. **Consola:** `page.on("console")` filtrado a `type() === "error"` + `page.on("pageerror")` (excepciones no capturadas). Se acumulan por paso y se descartan las anteriores al paso actual (ventana móvil).
2. **Red:** `page.on("response")` con `status >= 400`. Se registran método, URL (redactada de secretos con la lógica de `lib/redact-assist.ts`), y status. Requests de analytics/terceros configurables como ignorables (allowlist por dominio del `baseUrl`).
3. **DOM:** detección explícita de `role="alert"`, `role="alertdialog"`, `[aria-live="assertive"]` y patrones de toast/banner visibles (clases/atributos comunes), con su texto.

**Clasificación de severidad (determinista, conservadora):**

- `blocking`: respuesta 5xx a una request originada por la acción del usuario; excepción de página no capturada; `role="alert"` visible cuyo texto matchea patrones de error del idioma de la app.
- `warning`: 4xx (puede ser validación esperable), errores de consola genéricos, toasts informativos. Las `warning` NO cortan el loop — son evidencia para el juez.

Los `pageErrors` viajan: (a) al motor para la Capa 2, (b) al dossier del juez, (c) al strategist como parte del snapshot (para que ajuste el plan), (d) como `RunEvent` para el dashboard.

### 4.2 Capa 2 — Reglas duras (motor determinista)

**Dónde:** `packages/runner/src/assist/pipeline.ts`.

**a) Circuit breaker de errores.** Tras cada paso ejecutado, si el snapshot trae al menos un `PageError` con `severity: "blocking"` correlacionado con la acción (mismo paso o el inmediato anterior), el loop corta con `stopReason: "blocked-by-app-error"` y adjunta el/los errores como evidencia. No se consulta al LLM: el corte es por código.

**b) Victoria verificada.** `evaluateVictory` se endurece:

- La victoria se declara SOLO si las condiciones configuradas (URL, texto, selector visible) pasan la verificación del motor sobre la página real.
- **Se elimina** el atajo `objectiveLikelyCompleted` (declarar éxito por "formulario lleno + acción finalize") y las heurísticas de substring de `naturalLanguageVictorySatisfied` como vía de victoria autónoma. Donde la condición sea ambigua, el desenlace pasa al juez — no se adivina.
- **Double-check de persistencia:** para objetivos que implican persistir estado (crear/guardar/enviar), tras el candidato a victoria el motor ejecuta una verificación adicional: recarga la página (o re-navega a la vista de listado si la condición lo define) y re-verifica la condición. Si el dato no sobrevive la recarga, no hay victoria — se pasa al juez con la evidencia.
- Si no hay condición de victoria configurada, el desenlace SIEMPRE lo decide el juez (nunca el strategist).

**c) Detector de estancamiento.** Si el diff entre snapshots consecutivos es vacío/trivial durante N pasos (default: 3), se dispara el juez con motivo `stalled`. Esto reemplaza el "queda pensando" actual: dar vueltas ya no consume el presupuesto entero del run.

**d) Presupuestos existentes se mantienen** (`maxLoopMs`, `maxHorizons`, `maxHealingAttemptsPerStep`), pero al agotarse el desenlace lo clasifica el juez (motivo `budget-exhausted`) en lugar de mapear a un `fail` genérico.

### 4.3 Capa 3 — El juez

**Dónde:** módulo nuevo en el runner (`packages/runner/src/assist/judge.ts`) para el contrato/trigger, y factory del lado del API (`apps/api/src/services/assist-orchestrator.ts`, `createJudge`) siguiendo el mismo patrón de inyección que strategist/healer (`AssistDeps`). El runner NUNCA importa un LLM.

#### Decisiones de diseño (cerradas con el usuario, 2026-07-02)

| Decisión | Elección |
|---|---|
| Taxonomía | **Completa: 6 veredictos** (ver §5) |
| Evidencia visual | **Híbrido según provider**: dossier de texto como base autosuficiente; screenshot adjunto si el provider LLM del usuario soporta imágenes |
| Modelo | **El mismo LLM del usuario** (`UserLlmSettings`); la independencia viene del contexto fresco y el prompt distinto, no de otro modelo |
| Cadencia | **Por eventos**, nunca por cadencia fija |

#### Triggers de invocación (exhaustivos)

| Trigger | Motivo pasado al juez |
|---|---|
| Capa 1 capturó `PageError` (cualquier severidad) que la Capa 2 no resolvió por sí sola | `error-signal` |
| Candidato a victoria que requiere confirmación semántica (condición ambigua o sin condición configurada) | `victory-candidate` |
| N pasos sin progreso (diff de snapshot vacío) | `stalled` |
| Healer agotó intentos sobre un paso | `healing-exhausted` |
| Presupuesto agotado (`maxLoopMs` / `maxHorizons`) | `budget-exhausted` |

Los casos claros NO llegan al juez: los resuelve la Capa 2 gratis (victoria verificada limpia → `success`; error blocking evidente → `blocked-by-app-error` con veredicto automático `fail-app-bug` si la evidencia es un 5xx/crash inequívoco).

#### El dossier (input del juez)

El juez es tan bueno como su expediente. Recibe un paquete curado, NO el snapshot crudo:

```ts
type JudgeDossier = {
  goal: string;                       // objetivo en lenguaje natural
  victoryCondition?: VictoryConfig;   // qué se esperaba verificar
  reason: JudgeTrigger;               // por qué se lo invoca
  recentActions: Array<{              // últimas N acciones (default 8)
    step: string;                     // acción + selector
    outcome: "ok" | "failed" | "healed";
    error?: string;
  }>;
  currentSnapshot: string;            // snapshot sanitizado actual
  snapshotDiff: string;               // diff con el snapshot anterior (clave para "no pasó nada")
  pageErrors: PageError[];            // errores capturados por Capa 1
  deterministicChecks: Array<{        // resultado de los checks de Capa 2
    check: string;                    // p.ej. "victory.textIncludes('guardado')"
    passed: boolean;
  }>;
  screenshot?: Buffer;                // SOLO si el provider soporta imágenes
};
```

#### Output del juez (contrato estricto)

```ts
type JudgeVerdict = {
  verdict:
    | "continue"                  // el test sigue: obstáculo recuperable
    | "success"                   // objetivo cumplido (respaldado por evidencia)
    | "fail-app-bug"              // la app está rota: el test ENCONTRÓ un bug
    | "fail-test-broken"          // el plan/datos/condición de victoria están mal definidos
    | "fail-agent-lost"           // Ghostly no encontró el camino aunque existía
    | "inconclusive-environment"  // timeout, app caída, red: no se puede afirmar nada
    | "inconclusive";             // la evidencia no alcanza para ningún otro veredicto
  confidence: "high" | "medium" | "low";
  reasoning: string;              // explicación citando evidencia del dossier
  evidence: string[];             // referencias concretas (error X, check Y falló, diff vacío)
  hint?: string;                  // SOLO con verdict=continue: pista para el strategist
                                  // p.ej. "hay un modal de confirmación tapando el botón; cerralo primero"
};
```

Validación con Zod + reintento único ante output malformado (mismo patrón que el healer). Output malformado dos veces → `inconclusive` con nota de fallo del juez.

#### Reglas de comportamiento del juez (van al prompt del sistema)

1. **El juez clasifica, no actúa.** Jamás propone pasos ejecutables; a lo sumo una `hint` textual que el strategist recibirá como contexto.
2. **Sesgo anti-falso-éxito:** solo declara `success` si puede citar evidencia del dossier que lo PRUEBE. En la duda → `inconclusive`, nunca `success`. Un falso fallo molesta; un falso éxito destruye la confianza en el producto.
3. **No contradice la evidencia dura:** si un check determinista de victoria falló, `success` está prohibido; puede a lo sumo explicar el fallo.
4. **Distingue responsables** usando la taxonomía §5: ¿la app falló, el test está mal armado, el entorno se cayó, o Ghostly se perdió? Ese es su trabajo central.
5. **`continue` es legítimo** cuando el obstáculo es recuperable (modal, cookie banner, paso intermedio faltante) — con la `hint` correspondiente. Límite: máximo 2 intervenciones `continue` del juez por run; a la tercera invocación por el mismo motivo debe emitir veredicto terminal.

#### Observabilidad

Cada invocación del juez se persiste como `RunEvent` (`type: "judge-verdict"`) con dossier resumido, veredicto, confianza, razonamiento y evidencia. El dashboard los muestra en la línea de tiempo del run. Los veredictos son auditables y debuggeables — así se mide y mejora al juez.

---

## 5. Taxonomía de veredictos (contrato de producto)

Es LA distinción central de la versión: cuando algo falla, el usuario tiene que saber **qué arreglar**.

| Veredicto | Significado | Responsable | Acción del usuario | Semántica de producto |
|---|---|---|---|---|
| `success` | Objetivo cumplido y verificado | — | Nada | Test verde |
| `fail-app-bug` | La app está rota (500, crash, dato que no persiste) | La app bajo prueba | Arreglar la app | **El test HIZO su trabajo: encontró un bug.** Es el valor del producto — el dashboard lo presenta como hallazgo, no como vergüenza |
| `fail-test-broken` | Plan, datos o condición de victoria mal definidos | El test | Corregir el test/goal/victoria | No dice nada de la app |
| `fail-agent-lost` | Ghostly no encontró el camino aunque existía | Ghostly | Reportar / reintentar | Métrica de calidad interna del motor — alimenta nuestro backlog |
| `inconclusive-environment` | Timeout, app caída, red rota | El entorno | Revisar entorno y reintentar | No cuenta ni como pass ni como fail en tendencias |
| `inconclusive` | La evidencia no alcanza para afirmar nada | — | Revisar manualmente | Preferible a mentir; debe ser raro (medirlo) |

**Regla de mapeo en el motor:** los cortes puramente deterministas mapean directo — victoria verificada limpia → `success`; 5xx/crash inequívoco tras acción → `fail-app-bug`. Todo lo demás pasa por el juez.

---

## 6. Cambios en el modelo de datos, API y dashboard

### Prisma (`apps/api/prisma/schema.prisma`)

```prisma
model Run {
  // status se mantiene por compatibilidad: "pass" | "fail" | "running"
  // (pass ⇔ verdict=success; fail ⇔ cualquier fail-*; inconclusive-* mapea a fail para clientes viejos)
  verdict        String?  // taxonomía §5 — fuente de verdad del desenlace
  verdictReason  String?  // reasoning del juez o descripción del check determinista
  stopReason     String?  // el stopReason interno del pipeline, hoy no persistido
  // ...campos existentes
}
```

Migración: `pnpm --filter @ghostly-io/api db:migrate:dev` + `db:generate`. Backfill: runs históricos quedan con `verdict = null` (el dashboard muestra "sin clasificar").

### Runner (`packages/runner/src/assist/types.ts`)

- `AssistedFlowResult` pasa de `ok: boolean` a incluir `verdict`, `verdictReason`, `stopReason`, `judgeEvents[]`.
- `AssistDeps` suma `judge: (dossier: JudgeDossier) => Promise<JudgeVerdict>`.
- Nuevos `stopReason`: `blocked-by-app-error`, `judge-terminal-verdict`, `stalled-judged`.

### API

- `run.ts` persiste `verdict`/`verdictReason`/`stopReason` y emite `RunEvent` de veredicto.
- **Guardia de memoria:** `AssistMemory` se persiste SOLO si `verdict === "success"` **y** la victoria pasó los checks deterministas (doble confirmación). Además, un replay de memoria debe re-pasar la verificación de victoria; si no la pasa, esa memoria se invalida (se borra o marca stale) en lugar de reportar éxito.

### Dashboard (`apps/web`)

- Detalle de run: badge de veredicto (6 estados + "sin clasificar"), sección "por qué" con reasoning y evidencia, eventos del juez en la línea de tiempo.
- Listado de runs: filtro por veredicto.
- `fail-app-bug` con presentación de **hallazgo** (esto es el producto entregando valor, no un error de Ghostly).

---

## 7. Benchmark de fiabilidad (el contrato de calidad)

**Se construye PRIMERO, antes de tocar el pipeline.** Sin él, "mejoramos la fiabilidad" es una sensación, no un dato.

- **Contenido:** los 10 flujos reales usados en las pruebas manuales (incluidos los 4 que hoy fallan), como suite reproducible contra una **app fixture** local (app pequeña controlada por nosotros) con escenarios inyectables: error 500 al guardar, validación que rechaza, modal de confirmación, toast efímero, guardado que no persiste, app caída.
- **Etiquetado:** cada flujo tiene su desenlace esperado etiquetado a mano (`success`, `fail-app-bug`, etc.) — ground truth doble: mide el pipeline completo Y la precisión del juez por separado.
- **Métrica objetivo:** 10/10 veredictos veraces. Métricas secundarias: tasa de `inconclusive` (debe ser baja), falsos éxitos (debe ser CERO), invocaciones del juez por run (costo).
- **Dónde:** `packages/runner` (vitest ya existe ahí; la fixture app puede vivir en `packages/runner/test-fixtures/`). Corre en cada cambio del pipeline/prompts.
- Todo cambio de prompt del juez o del strategist se valida contra el benchmark antes de mergear.

---

## 8. Fases de implementación (orden con dependencias)

```
Fase 0: Benchmark + fixture app          ← primero, define "terminado"
Fase 1: Percepción (observer ampliado)   ← el juez ciego no sirve; va antes
Fase 2: Reglas duras (circuit breaker,
        victoria verificada, estancamiento)
Fase 3: Juez (contrato, dossier, prompt,
        triggers, guardia de memoria)
Fase 4: Persistencia + dashboard
        (migración, veredictos visibles)
Fase 5: Operación desatendida:
        - `ghostly run --ci`: headless (ya soportado), exit codes por
          veredicto, reporte JSON/JUnit → entrada directa a GitHub Actions
        - Scheduler local en el daemon (`ghostly up`): cron por proyecto,
          local-first, sin nube
        - Retención de historial + vista de tendencias por veredicto
```

Cada fase es entregable por separado y deja el sistema funcionando. Las fases 1–4 son el corazón "Trust"; la 5 es lo operativo estilo BugBug y puede recortarse de la versión si hiciera falta, las anteriores no.

### Criterios de aceptación de la versión

1. Benchmark: 10/10 veredictos veraces; **cero falsos éxitos**.
2. Un error 500 al guardar corta el run en ese paso con `fail-app-bug` + evidencia (no consume el presupuesto restante).
3. Un "guardado" que no persiste tras recarga NO produce `success`.
4. Un modal tapando el botón produce `continue` con hint, y el run puede completarse.
5. Ningún `AssistMemory` nuevo proviene de un run sin doble confirmación de éxito.
6. El dashboard muestra veredicto + por qué en cada run nuevo.
7. `ghostly run --ci` devuelve exit code ≠ 0 exactamente cuando el veredicto no es `success`, con reporte parseable.

---

## 9. Riesgos y preguntas abiertas

| Riesgo | Mitigación |
|---|---|
| El double-check por recarga puede romper flujos con estado efímero (wizard multi-paso) | El double-check se aplica solo a objetivos de persistencia; la condición de victoria puede declarar `revalidate: false` explícito |
| Clasificación `blocking` vs `warning` demasiado agresiva (4xx legítimos de la app) | Empezar conservador (solo 5xx/crash/alert como blocking) y calibrar con el benchmark |
| Costo/latencia del juez en providers CLI lentos | Cadencia por eventos + dossier compacto; medir invocaciones/run en el benchmark |
| El juez hereda sesgos del mismo modelo del strategist | Contexto fresco + prompt distinto + sesgo anti-falso-éxito; si el benchmark muestra techo, evaluar modelo de juez separado (decisión ya contemplada como evolución) |
| Toasts efímeros desaparecen antes del snapshot | Los listeners de consola/red son continuos (no por snapshot); para DOM, capturar `role="alert"` con un MutationObserver acumulativo si el benchmark lo exige |

Preguntas abiertas (no bloquean el arranque):

- ¿La fixture app del benchmark se versiona dentro del monorepo o como repo aparte? (propuesta: dentro, en `packages/runner/test-fixtures/`).
- Formato exacto del reporte CI (JSON propio + JUnit XML mínimo, o solo JSON en v0.2).
- Allowlist de dominios ignorables en captura de red: ¿config por proyecto o global?

---

## 10. Referencias

- Decisiones persistidas en Engram: `architecture/ghostly-v0.2-trust-release` (diagnóstico + propuesta) y `architecture/ghostly-judge-agent` (diseño del juez).
- Código relevante: `packages/runner/src/assist/pipeline.ts`, `observer.ts`, `healer.ts`, `types.ts`; `apps/api/src/services/assist-orchestrator.ts`, `assist-plan.ts`; `apps/api/src/routes/run.ts`; `apps/api/prisma/schema.prisma`; `apps/api/src/lib/redact-assist.ts`.
- Análisis competitivo que motivó la fase operativa: BugBug.io (cloud runs, scheduling, CI/CD) — 2026-07-02.
