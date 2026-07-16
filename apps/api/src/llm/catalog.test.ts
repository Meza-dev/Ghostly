import { describe, expect, it } from "vitest";
import { getCatalogEntry, isModelAllowed } from "./catalog.js";

const cursor = getCatalogEntry("cursor-cli")!;
const openai = getCatalogEntry("openai")!;

describe("isModelAllowed (C1 — allow-list y charset del campo model)", () => {
  it("rechaza inyección de comandos (Windows): 'auto & whoami'", () => {
    expect(isModelAllowed(cursor, "auto & whoami")).toBe(false);
    expect(isModelAllowed(openai, "gpt-4o & whoami")).toBe(false);
  });

  it("rechaza argument-injection (POSIX/CWE-88): model que empieza con '-'", () => {
    expect(isModelAllowed(cursor, "--dangerous-flag")).toBe(false);
    expect(isModelAllowed(openai, "-rf")).toBe(false);
  });

  it("rechaza espacios y metacaracteres de shell", () => {
    expect(isModelAllowed(cursor, "auto | cat")).toBe(false);
    expect(isModelAllowed(cursor, "auto; rm -rf")).toBe(false);
    expect(isModelAllowed(cursor, "a`b`")).toBe(false);
    expect(isModelAllowed(cursor, "auto$(whoami)")).toBe(false);
  });

  it("acepta modelos válidos del catálogo estático", () => {
    expect(isModelAllowed(cursor, "auto")).toBe(true);
    expect(isModelAllowed(cursor, "composer-2.5")).toBe(true);
    expect(isModelAllowed(openai, "gpt-4o-mini")).toBe(true);
    expect(isModelAllowed(openai, "gpt-4o")).toBe(true);
  });

  it("proveedor NO-live: rechaza un id fuera del catálogo aunque el charset sea seguro", () => {
    expect(isModelAllowed(openai, "gpt-inexistente")).toBe(false);
  });

  it("proveedor live (cursor-cli): acepta ids charset-seguros no listados estáticamente", () => {
    // El catálogo vivo puede crecer; el charset garantiza que no haya inyección.
    expect(isModelAllowed(cursor, "claude-sonnet-9-thinking")).toBe(true);
  });
});
