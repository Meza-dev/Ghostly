/**
 * Guardia de memoria — doble confirmación (spec §6, Fase 3b GHOST-30):
 * "AssistMemory se persiste SOLO si verdict === success y la victoria pasó
 * los checks deterministas (doble confirmación)."
 *
 * Función PURA: decide si un `AssistedRunResult` califica para persistir en
 * `AssistMemory`, sin tocar Prisma/DB (eso es `run.ts`, apps/api). Vive en el
 * runner para poder probarla con vitest — apps/api no tiene test runner.
 *
 * Regla clave (deducida del código del pipeline, `pipeline.ts`): una victoria
 * puramente determinista (sin pasar por el juez) NUNCA setea `result.verdict`
 * — el campo queda `undefined` y solo `result.ok === true` la marca. El juez
 * SÍ setea `verdict` explícitamente (`applyTerminalJudgeVerdict`), incluyendo
 * `verdict: "success"` cuando cita evidencia suficiente — pero por
 * construcción el juez SOLO se invoca cuando la Capa 2 (checks deterministas)
 * ya agotó lo que podía resolver gratis (spec §3, jerarquía de autoridad).
 * Por eso un `verdict === "success"` proveniente del juez NO representa una
 * "doble confirmación determinista": es la ÚNICA confirmación, y viene de un
 * LLM, no de un check duro. La doble confirmación real es: `ok === true` +
 * NINGÚN veredicto explícito (el camino puramente determinista).
 */
import { describe, expect, it } from "vitest";
import { qualifiesForMemoryPersistence } from "../judge.js";
import type { AssistedRunResult } from "../pipeline.js";

function baseResult(overrides: Partial<AssistedRunResult> = {}): AssistedRunResult {
  return {
    ok: true,
    durationMs: 100,
    steps: [],
    events: [],
    ...overrides,
  };
}

describe("qualifiesForMemoryPersistence (spec §6 — doble confirmación)", () => {
  it("qualifies a clean deterministic victory (ok=true, no explicit verdict set)", () => {
    expect(qualifiesForMemoryPersistence(baseResult({ ok: true, stopReason: "victory-met" }))).toBe(true);
  });

  it("does NOT qualify a judge-declared success (verdict='success' but not deterministically double-confirmed)", () => {
    expect(
      qualifiesForMemoryPersistence(
        baseResult({ ok: true, verdict: "success", stopReason: "judge-terminal-verdict" }),
      ),
    ).toBe(false);
  });

  it("does NOT qualify any failing run regardless of verdict", () => {
    expect(qualifiesForMemoryPersistence(baseResult({ ok: false, verdict: "fail-app-bug" }))).toBe(false);
    expect(qualifiesForMemoryPersistence(baseResult({ ok: false, verdict: "inconclusive" }))).toBe(false);
  });

  it("does NOT qualify ok=true with a non-success verdict (defensive — should not happen after the runOk fix, but never trust ok alone)", () => {
    expect(
      qualifiesForMemoryPersistence(baseResult({ ok: true, verdict: "fail-test-broken" as never })),
    ).toBe(false);
  });

  it("does NOT qualify inconclusive-environment even if ok were somehow true", () => {
    expect(
      qualifiesForMemoryPersistence(baseResult({ ok: true, verdict: "inconclusive-environment" as never })),
    ).toBe(false);
  });
});
