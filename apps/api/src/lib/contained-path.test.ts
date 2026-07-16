import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containedPath } from "./contained-path.js";

let root: string;
let base: string;
let outsideFile: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "ghostly-contain-"));
  root = join(base, "artifacts");
  mkdirSync(join(root, "run-1"), { recursive: true });
  writeFileSync(join(root, "run-1", "shot.png"), "PNGDATA");
  outsideFile = join(base, "secret.env");
  writeFileSync(outsideFile, "JWT_SECRET=super");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("containedPath (C3 — contención de ruta bajo la raíz)", () => {
  it("devuelve la ruta real para un artefacto legítimo dentro de la raíz", () => {
    const got = containedPath(root, "run-1/shot.png");
    expect(got).not.toBeNull();
    expect(got).toBe(resolve(root, "run-1", "shot.png"));
  });

  it("rechaza traversal con '../' literal", () => {
    expect(containedPath(root, "../secret.env")).toBeNull();
    expect(containedPath(root, "../../secret.env")).toBeNull();
  });

  it("rechaza traversal anidado (a/../../secret)", () => {
    expect(containedPath(root, "run-1/../../secret.env")).toBeNull();
  });

  it("rechaza una ruta absoluta que ignora la raíz", () => {
    expect(containedPath(root, outsideFile)).toBeNull();
  });

  it("rechaza traversal con separador backslash (Windows)", () => {
    expect(containedPath(root, "..\\secret.env")).toBeNull();
  });

  it("devuelve null para un archivo inexistente dentro de la raíz (realpath falla)", () => {
    expect(containedPath(root, "run-1/no-existe.png")).toBeNull();
  });
});
