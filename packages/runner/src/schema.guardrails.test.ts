import { describe, expect, it } from "vitest";
import { safeParseRunInput } from "./schema.js";

describe("runInput guardrails", () => {
  it("acepta goto relativo en el mismo origin", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "goto", url: "/signup" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza goto a origin distinto", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "goto", url: "https://otro-sitio.com/signup" }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join(".") === "steps.0.url")).toBe(true);
    }
  });

  it("rechaza más pasos que el máximo permitido", () => {
    const parsed = safeParseRunInput(
      {
        baseUrl: "https://example.com",
        steps: [
          { action: "goto", url: "/" },
          { action: "waitForSelector", selector: "h1" },
        ],
      },
      { maxSteps: 1 },
    );
    expect(parsed.success).toBe(false);
  });

  it("rechaza timeout por encima del máximo permitido", () => {
    const parsed = safeParseRunInput(
      {
        baseUrl: "https://example.com",
        steps: [{ action: "goto", url: "/" }],
        defaultTimeoutMs: 10_000,
      },
      { maxTimeoutMs: 5_000 },
    );
    expect(parsed.success).toBe(false);
  });

  it("rechaza acciones fuera del allow-list", () => {
    const parsed = safeParseRunInput({
      baseUrl: "https://example.com",
      steps: [{ action: "screenshot" }],
    });
    expect(parsed.success).toBe(false);
  });
});
