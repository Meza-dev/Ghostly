import { describe, expect, it } from "vitest";
import { sanitizeHealerSteps } from "../healer.js";

describe("sanitizeHealerSteps", () => {
  const baseUrl = "https://example.com";

  it("acepta pasos válidos dentro del mismo origin", () => {
    const result = sanitizeHealerSteps(
      baseUrl,
      [
        { action: "click", selector: "button.accept-cookies" },
        { action: "waitForSelector", selector: "form" },
      ],
      30_000,
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.action).toBe("click");
  });

  it("rechaza goto a origen distinto", () => {
    const result = sanitizeHealerSteps(
      baseUrl,
      [{ action: "goto", url: "https://evil.com/steal" }],
      30_000,
    );
    expect(result).toHaveLength(0);
  });

  it("recorta a 3 pasos máximo", () => {
    const result = sanitizeHealerSteps(
      baseUrl,
      [
        { action: "click", selector: "#a" },
        { action: "click", selector: "#b" },
        { action: "click", selector: "#c" },
        { action: "click", selector: "#d" },
        { action: "click", selector: "#e" },
      ],
      30_000,
    );
    expect(result).toHaveLength(3);
  });

  it("devuelve vacío si no hay pasos válidos", () => {
    const result = sanitizeHealerSteps(
      baseUrl,
      [{ action: "goto", url: "https://otro.com/x" }],
      30_000,
    );
    expect(result).toEqual([]);
  });

  it("filtra selectores ambiguos comunes (button[type=submit], input, etc.)", () => {
    const result = sanitizeHealerSteps(
      baseUrl,
      [
        { action: "click", selector: "button[type=submit]" },
        { action: "fill", selector: "input", value: "x" },
        { action: "click", selector: "button:has-text(\"Ingresar\")" },
      ],
      30_000,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("click");
  });
});
