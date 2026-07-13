import { describe, expect, it } from "vitest";
import { coerceStep } from "./assist-orchestrator.js";

describe("coerceStep — nuevos verbos de acción", () => {
  it("selectOption con value string pasa sin volverse null", () => {
    const step = coerceStep({ action: "selectOption", selector: "#cliente", value: "Distribuidora Norte" });
    expect(step).toEqual({ action: "selectOption", selector: "#cliente", value: "Distribuidora Norte" });
  });

  it("selectOption con value array (multi-select) pasa sin volverse null", () => {
    const step = coerceStep({ action: "selectOption", selector: "#etiquetas", value: ["Urgente", "VIP"] });
    expect(step).toEqual({ action: "selectOption", selector: "#etiquetas", value: ["Urgente", "VIP"] });
  });

  it("check pasa sin volverse null", () => {
    const step = coerceStep({ action: "check", selector: "#urgente" });
    expect(step).toEqual({ action: "check", selector: "#urgente" });
  });

  it("uncheck pasa sin volverse null", () => {
    const step = coerceStep({ action: "uncheck", selector: "#urgente" });
    expect(step).toEqual({ action: "uncheck", selector: "#urgente" });
  });

  it("setInputFiles con files array pasa sin volverse null", () => {
    const step = coerceStep({ action: "setInputFiles", selector: "#adjunto", files: ["comprobante.pdf"] });
    expect(step).toEqual({ action: "setInputFiles", selector: "#adjunto", files: ["comprobante.pdf"] });
  });

  it("hover pasa sin volverse null", () => {
    const step = coerceStep({ action: "hover", selector: "#ayuda" });
    expect(step).toEqual({ action: "hover", selector: "#ayuda" });
  });

  it("normaliza sinónimos select/choose→selectOption y upload→setInputFiles", () => {
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
    expect(coerceStep({ action: "upload", selector: "#adjunto", files: ["a.pdf"] })).toEqual({
      action: "setInputFiles",
      selector: "#adjunto",
      files: ["a.pdf"],
    });
  });

  it("rechaza selectOption sin value", () => {
    expect(coerceStep({ action: "selectOption", selector: "#cliente" })).toBeNull();
  });

  it("rechaza setInputFiles sin files", () => {
    expect(coerceStep({ action: "setInputFiles", selector: "#adjunto" })).toBeNull();
  });
});
