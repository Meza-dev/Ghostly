import { describe, expect, it } from "vitest";
import { CLI_AGENT_REGISTRY } from "./cli-registry.js";

/**
 * IA-2.1 — El provider `cursor-cli` lanza un agente de código. La única barrera
 * confirmada contra que actúe (edite/ejecute) en vez de responder es el modo
 * no-agéntico de un solo disparo. Estos tests FIJAN esa invariante: si alguien
 * cambia el modo por uno con edición/shell, o quita el print/one-shot, el test
 * rompe. `--mode ask` (respuesta, no acción) y `-p` (print/no interactivo) NO
 * deben depender del `model` ni de ningún input.
 */
describe("cursor-cli buildArgs (IA-2.1 — modo no-agéntico como invariante)", () => {
  const def = CLI_AGENT_REGISTRY["cursor-cli"]!;

  it("siempre incluye `--mode ask`, sea cual sea el model", () => {
    for (const model of ["composer-2.5", "auto", "cualquier-cosa"]) {
      const args = def.buildArgs({ model });
      const i = args.indexOf("--mode");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe("ask");
    }
  });

  it("siempre invoca en modo print/one-shot (`-p`), no interactivo", () => {
    const args = def.buildArgs({ model: "auto" });
    expect(args).toContain("-p");
  });
});
