import { describe, expect, it } from "vitest";
import { msg, pickLang } from "./pick.js";

describe("pickLang", () => {
  it("sin header -> en (default)", () => {
    expect(pickLang(undefined)).toBe("en");
  });

  it("es-AR,es -> es", () => {
    expect(pickLang("es-AR,es")).toBe("es");
  });

  it("en-US -> en", () => {
    expect(pickLang("en-US")).toBe("en");
  });

  it("header inválido/basura -> en", () => {
    expect(pickLang("xx-YY")).toBe("en");
  });

  it("es -> es", () => {
    expect(pickLang("es")).toBe("es");
  });

  it("es-ES,en;q=0.8 -> es", () => {
    expect(pickLang("es-ES,en;q=0.8")).toBe("es");
  });
});

describe("msg", () => {
  it("resuelve un key simple en ambos idiomas", () => {
    expect(msg("auth.invalidCredentials", "en")).toBe("invalid credentials");
    expect(msg("auth.invalidCredentials", "es")).toBe("credenciales inválidas");
  });

  it("interpola {max} en plan.goalTooLong", () => {
    expect(msg("plan.goalTooLong", "en", { max: 500 })).toBe("goal exceeds the maximum allowed (500)");
    expect(msg("plan.goalTooLong", "es", { max: 500 })).toBe("goal excede el máximo permitido (500)");
  });

  it("interpola {baseUrl} en assist.targetUnreachable", () => {
    const es = msg("assist.targetUnreachable", "es", { baseUrl: "http://localhost:3000" });
    expect(es).toContain("http://localhost:3000");
    expect(es).toContain("No se pudo alcanzar");
  });

  it("resuelve un segundo mensaje en ambos idiomas (run.notFound)", () => {
    expect(msg("run.notFound", "en")).toBe("run not found");
    expect(msg("run.notFound", "es")).toBe("run no encontrado");
  });
});
