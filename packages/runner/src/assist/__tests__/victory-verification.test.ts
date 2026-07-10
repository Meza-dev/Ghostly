/**
 * Victoria verificada + double-check de persistencia (Capa 2, spec §4.2b) — RED baseline.
 *
 * Fase 2b, Kanon GHOST-28: la victoria se declara SOLO por verificación del motor
 * sobre la página real. Estos tests cubren las funciones puras extraídas de
 * `pipeline.ts` (detección de goals de persistencia, decisión de revalidar,
 * detector de estancamiento) — el resto del comportamiento (integración con el
 * loop real + reload de Playwright) se cubre en el benchmark de fiabilidad.
 */
import { describe, expect, it } from "vitest";
import { goalImpliesPersistence, shouldRevalidateVictory, detectStall } from "../pipeline.js";
import type { VictoryCondition } from "../types.js";

describe("goalImpliesPersistence (spec §4.2b — double-check de persistencia)", () => {
  it("detects Spanish 'crear' as implying persistence", () => {
    expect(goalImpliesPersistence("Crear una nota con título 'X'")).toBe(true);
  });

  it("detects Spanish 'guardar' as implying persistence", () => {
    expect(goalImpliesPersistence("Guardar los cambios del formulario")).toBe(true);
  });

  it("detects Spanish 'enviar' as implying persistence", () => {
    expect(goalImpliesPersistence("Enviar el formulario de contacto")).toBe(true);
  });

  it("does not flag exploratory goals without persistence intent", () => {
    expect(goalImpliesPersistence("Explorar la página de notas")).toBe(false);
  });

  it("is case-insensitive and accent-insensitive", () => {
    expect(goalImpliesPersistence("CREAR una calificación")).toBe(true);
    expect(goalImpliesPersistence("guardó el registro")).toBe(true);
  });
});

describe("shouldRevalidateVictory (spec §4.2b — opt-out explícito)", () => {
  it("returns true for a persistence-implying goal with no victory config (default true)", () => {
    expect(shouldRevalidateVictory("Crear una nota", undefined)).toBe(true);
  });

  it("returns false when the goal does not imply persistence, even with no explicit opt-out", () => {
    expect(shouldRevalidateVictory("Explorar el dashboard", undefined)).toBe(false);
  });

  it("respects an explicit revalidate: false opt-out even when the goal implies persistence", () => {
    const victory: VictoryCondition = { textIncludes: ["ok"], revalidate: false };
    expect(shouldRevalidateVictory("Crear una nota", victory)).toBe(false);
  });

  it("respects an explicit revalidate: true even when the goal does not look like persistence", () => {
    const victory: VictoryCondition = { textIncludes: ["ok"], revalidate: true };
    expect(shouldRevalidateVictory("Ver el estado actual", victory)).toBe(true);
  });
});

describe("detectStall (spec §4.2c — detector de estancamiento)", () => {
  it("does not stall before reaching the threshold (default N=3)", () => {
    expect(detectStall(2, 3)).toBe(false);
  });

  it("fires exactly at the configured threshold", () => {
    expect(detectStall(3, 3)).toBe(true);
  });

  it("fires above the threshold", () => {
    expect(detectStall(4, 3)).toBe(true);
  });

  it("supports a custom N", () => {
    expect(detectStall(2, 2)).toBe(true);
    expect(detectStall(1, 2)).toBe(false);
  });
});
