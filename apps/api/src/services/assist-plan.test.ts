import { describe, expect, it } from "vitest";
import { coerceStep } from "./assist-plan.js";

describe("coerceStep (assist-plan.ts) — selectOption (T1, gate del review de T0)", () => {
  it("selectOption con value string pasa sin volverse null", () => {
    const step = coerceStep({ action: "selectOption", selector: "#cliente", value: "Distribuidora Norte" });
    expect(step).toEqual({ action: "selectOption", selector: "#cliente", value: "Distribuidora Norte" });
  });

  it("selectOption con value array (multi-select) pasa sin volverse null", () => {
    const step = coerceStep({ action: "selectOption", selector: "#etiquetas", value: ["Urgente", "VIP"] });
    expect(step).toEqual({ action: "selectOption", selector: "#etiquetas", value: ["Urgente", "VIP"] });
  });

  it("normaliza sinónimos select/choose→selectOption", () => {
    expect(coerceStep({ action: "select", selector: "#cliente", value: "Norte" })).toEqual({
      action: "selectOption",
      selector: "#cliente",
      value: "Norte",
    });
    expect(coerceStep({ action: "choose", selector: "#cliente", value: "Norte" })).toEqual({
      action: "selectOption",
      selector: "#cliente",
      value: "Norte",
    });
  });

  it("rechaza selectOption sin value", () => {
    expect(coerceStep({ action: "selectOption", selector: "#cliente" })).toBeNull();
  });

  it("rechaza selectOption sin selector", () => {
    expect(coerceStep({ action: "selectOption", value: "Norte" })).toBeNull();
  });

  it("los verbos existentes (goto/click/fill) siguen intactos", () => {
    expect(coerceStep({ action: "goto", url: "/login" })).toEqual({ action: "goto", url: "/login" });
    expect(coerceStep({ action: "click", selector: "#btn" })).toEqual({ action: "click", selector: "#btn" });
  });
});
