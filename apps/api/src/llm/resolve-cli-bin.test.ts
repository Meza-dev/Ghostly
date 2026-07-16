import { describe, expect, it } from "vitest";
import { isWindowsCmdScript } from "./resolve-cli-bin.js";

describe("isWindowsCmdScript (C1 — solo scripts .cmd/.bat/.ps1 requieren envoltura cmd.exe)", () => {
  it("reconoce .cmd/.bat/.ps1", () => {
    expect(isWindowsCmdScript("C:/x/cursor-agent.cmd")).toBe(true);
    expect(isWindowsCmdScript("C:/x/foo.bat")).toBe(true);
    expect(isWindowsCmdScript("C:/x/foo.ps1")).toBe(true);
  });

  it("NO trata el binario pelado 'agent' como script de shell (sin rama especial)", () => {
    expect(isWindowsCmdScript("agent")).toBe(false);
  });

  it("un ejecutable normal no es script", () => {
    expect(isWindowsCmdScript("agent.exe")).toBe(false);
    expect(isWindowsCmdScript("/usr/bin/agent")).toBe(false);
  });
});
