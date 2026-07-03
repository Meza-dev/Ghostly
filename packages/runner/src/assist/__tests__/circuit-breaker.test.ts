/**
 * Circuit breaker de errores (Capa 2, spec §4.2a) — RED baseline.
 *
 * Fase 2a, Kanon GHOST-27: tras cada paso ejecutado, si el snapshot trae al
 * menos un `PageError` con severity="blocking" correlacionado con la acción
 * (mismo paso o el inmediato anterior), el loop debe cortar sin consultar al
 * LLM. Este archivo prueba la función pura de detección, aislada del loop
 * de Playwright — matchea el patrón de `pipeline.ts` (funciones puras
 * exportadas y testeadas sin mocks de Page cuando es posible).
 */
import { describe, expect, it } from "vitest";
import { detectBlockingAppError } from "../pipeline.js";
import type { PageError } from "../types.js";

function blockingError(observedAtStep: number, overrides: Partial<PageError> = {}): PageError {
  return {
    source: "network",
    severity: "blocking",
    message: "POST /save → 500",
    detail: { url: "/save", status: 500 },
    observedAtStep,
    ...overrides,
  };
}

function warningError(observedAtStep: number, overrides: Partial<PageError> = {}): PageError {
  return {
    source: "network",
    severity: "warning",
    message: "GET /notes → 404",
    detail: { url: "/notes", status: 404 },
    observedAtStep,
    ...overrides,
  };
}

describe("detectBlockingAppError (Capa 2 — circuit breaker, spec 4.2a)", () => {
  it("returns undefined when there are no pageErrors at all", () => {
    const result = detectBlockingAppError([], 2);
    expect(result).toBeUndefined();
  });

  it("returns undefined when only warning-severity errors are correlated to the current step", () => {
    const result = detectBlockingAppError([warningError(2)], 2);
    expect(result).toBeUndefined();
  });

  it("detects a blocking error observed at the exact current step index", () => {
    const err = blockingError(2);
    const result = detectBlockingAppError([err], 2);
    expect(result).toEqual([err]);
  });

  it("detects a blocking error observed at the immediately prior step index", () => {
    const err = blockingError(1);
    const result = detectBlockingAppError([err], 2);
    expect(result).toEqual([err]);
  });

  it("does NOT correlate a blocking error observed two steps before the current one", () => {
    const err = blockingError(0);
    const result = detectBlockingAppError([err], 2);
    expect(result).toBeUndefined();
  });

  it("ignores blocking errors from a future step index (defensive — should never happen upstream)", () => {
    const err = blockingError(5);
    const result = detectBlockingAppError([err], 2);
    expect(result).toBeUndefined();
  });

  it("collects ALL correlated blocking errors when multiple are present, ignoring warnings", () => {
    const blockingCurrent = blockingError(2, { message: "pageerror: TypeError" , source: "console" });
    const blockingPrior = blockingError(1);
    const warningCurrent = warningError(2);
    const result = detectBlockingAppError([warningCurrent, blockingPrior, blockingCurrent], 2);
    expect(result).toEqual([blockingPrior, blockingCurrent]);
  });
});
