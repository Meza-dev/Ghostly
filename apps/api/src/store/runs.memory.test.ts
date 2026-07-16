import { describe, expect, it } from "vitest";
import { parseMemorySteps } from "./runs.js";

/**
 * IA-4.1 — El seed de memoria replayado NO debe saltar la validación de un run
 * fresco. Una `AssistMemory` envenenada (dev.db manipulada, inyección persistida)
 * no puede replayar pasos cross-origin ni malformados.
 */
const BASE = "http://localhost:3000";

describe("parseMemorySteps (IA-4.1 — re-validación del seed de memoria)", () => {
  it("acepta una memoria legítima same-origin", () => {
    const raw = JSON.stringify([
      { action: "goto", url: "http://localhost:3000/login" },
      { action: "fill", selector: "#user", value: "admin" },
      { action: "click", selector: "#submit" },
    ]);
    const steps = parseMemorySteps(raw, BASE);
    expect(steps).toHaveLength(3);
  });

  it("acepta un goto RELATIVO (resuelve contra baseUrl → same-origin)", () => {
    const raw = JSON.stringify([{ action: "goto", url: "/dashboard" }]);
    expect(parseMemorySteps(raw, BASE)).toHaveLength(1);
  });

  it("RECHAZA el seed entero si un goto es cross-origin", () => {
    const raw = JSON.stringify([
      { action: "goto", url: "http://localhost:3000/ok" },
      { action: "goto", url: "http://attacker.example/steal" },
    ]);
    expect(parseMemorySteps(raw, BASE)).toEqual([]);
  });

  it("descarta pasos con acción desconocida (validación estructural)", () => {
    const raw = JSON.stringify([
      { action: "click", selector: "#a" },
      { action: "exfiltrate", payload: "leak" },
    ]);
    // El paso malicioso se cae; solo sobrevive el válido.
    const steps = parseMemorySteps(raw, BASE);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.action).toBe("click");
  });

  it("devuelve [] ante JSON malformado o no-array", () => {
    expect(parseMemorySteps("no soy json", BASE)).toEqual([]);
    expect(parseMemorySteps(JSON.stringify({ not: "array" }), BASE)).toEqual([]);
  });

  it("sin baseUrl aplica solo la capa estructural (peek pre-guardado)", () => {
    const raw = JSON.stringify([
      { action: "click", selector: "#a" },
      { action: "desconocida" },
    ]);
    const steps = parseMemorySteps(raw);
    expect(steps).toHaveLength(1);
  });

  it("rechaza un seed que excede el tope de pasos de memoria", () => {
    const many = Array.from({ length: 50 }, () => ({ action: "click", selector: "#a" }));
    // 50 pasos válidos pero por encima del cap (40) → seed rechazado por DoS.
    expect(parseMemorySteps(JSON.stringify(many), BASE)).toEqual([]);
  });
});
