# App fixture del benchmark de fiabilidad

Base para medir la fiabilidad del pipeline asistido de Ghostly, siguiendo
[`docs/specs/ghostly-v0.2-trust-release.md`](../../../docs/specs/ghostly-v0.2-trust-release.md)
§7. No depende de servicios externos ni de un LLM: los flujos usan pasos ya
resueltos (`assist.isFullPlan = true`), así el benchmark corre offline y
determinista en cada cambio del pipeline/prompts.

## Piezas

- **`app.ts`** — server HTTP mínimo (`node:http`, sin dependencias nuevas) que
  simula un formulario de "crear nota". El escenario a reproducir se controla
  con el query param `?scenario=` en cualquier request.
- **`flows.ts`** — 10 flujos etiquetados a mano (`BENCHMARK_FLOWS`): objetivo,
  pasos concretos, escenario del fixture, veredicto esperado y motivo.
- **`benchmark-runner.ts`** — corre los 10 flujos contra la app fixture usando
  `runAssistedFlow` real y arma el reporte (veredictos veraces, falsos
  éxitos, tasa de inconclusive, invocaciones del juez).

## Escenarios disponibles

| Escenario | Qué simula |
|---|---|
| `happy-path` | Guardado real y persistente |
| `500-on-save` | El servidor responde 500 al guardar |
| `validation-reject` | Rechaza el guardado por título vacío (comportamiento esperado) |
| `modal-blocking-button` | Un modal de confirmación tapa el formulario al cargar |
| `ephemeral-toast` | Guarda de verdad, pero el toast de éxito es efímero |
| `non-persisting-save` | Responde éxito (toast + fila fantasma) pero NO persiste la nota |
| `app-down` | El servidor rechaza la conexión (app caída) |

## Correr el benchmark

```bash
pnpm --filter @ghostly-io/runner test reliability-benchmark
```

El test vive en
[`packages/runner/src/assist/__tests__/reliability-benchmark.test.ts`](../src/assist/__tests__/reliability-benchmark.test.ts)
e imprime la tabla de resultados por consola (`formatBenchmarkReport`).

## Cómo agregar un flujo nuevo

1. Elegí (o agregá) un escenario en `app.ts` que reproduzca el modo de fallo real.
2. Sumá una entrada a `BENCHMARK_FLOWS` en `flows.ts` con:
   - `goal`: objetivo en lenguaje natural.
   - `steps`: pasos concretos (full-plan, sin ambigüedad — el benchmark no usa LLM).
   - `assist.victory`: condición de victoria que el motor puede verificar.
   - `expectedVerdict`: la etiqueta de ground truth, según la taxonomía de la spec §5.
   - `rationale`: por qué ese es el veredicto correcto (para quien revise/etiquete).
3. Corré el benchmark y confirmá que el reporte incluye el flujo nuevo.

## Cómo etiquetar el ground truth

Cada flujo se etiqueta a mano con el veredicto que un humano esperaría ver en
el dashboard. La taxonomía completa (6 veredictos) está en la spec §5:
`success`, `fail-app-bug`, `fail-test-broken`, `fail-agent-lost`,
`inconclusive-environment`, `inconclusive`. Un falso éxito (el benchmark
reporta `success` cuando el ground truth es otro) es el peor defecto posible
— el reporte lo marca explícitamente como "FALSO ÉXITO".
