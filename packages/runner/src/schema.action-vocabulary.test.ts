import { describe, expect, it } from "vitest";
import { safeParseRunInput } from "./schema.js";

describe("runInput — nuevos verbos de acción (selectOption/check/uncheck/setInputFiles/hover)", () => {
  it("acepta selectOption con value string", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "selectOption", selector: "#cliente", value: "Distribuidora Norte" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta selectOption con value array (multi-select)", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "selectOption", selector: "#etiquetas", value: ["Urgente", "Cliente VIP"] }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza selectOption con value array vacío", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "selectOption", selector: "#etiquetas", value: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("acepta check", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "check", selector: "#urgente" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta uncheck", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "uncheck", selector: "#urgente" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta setInputFiles con nombres de archivo relativos", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "setInputFiles", selector: "#adjunto", files: ["comprobante.pdf"] }],
      uploadFixturesDir: "test-fixtures/uploads",
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza setInputFiles con files vacío", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "setInputFiles", selector: "#adjunto", files: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("acepta hover", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "hover", selector: "#ayuda" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta un plan mixto con los 5 verbos nuevos en un solo run", () => {
    const parsed = safeParseRunInput(
      {
        baseUrl: "https://example.com",
        steps: [
          { action: "selectOption", selector: "#cliente", value: "Norte" },
          { action: "check", selector: "#urgente" },
          { action: "uncheck", selector: "#recordar" },
          { action: "hover", selector: "#ayuda" },
          { action: "setInputFiles", selector: "#adjunto", files: ["comprobante.pdf"] },
        ],
        uploadFixturesDir: "test-fixtures/uploads",
      },
      { maxSteps: 10 },
    );
    expect(parsed.success).toBe(true);
  });
});
