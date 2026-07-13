/**
 * Firma de estado del snapshot (`snapshotStateKey`) — usada por el detector de
 * mutación / estancamiento (spec §4.2c) para decidir si un paso cambió la
 * página. La firma debe reflejar cambios en CUALQUIER parte del árbol, no solo
 * en los primeros caracteres: un click que cierra un modal cuyo efecto vive más
 * allá del corte producía una firma idéntica -> falso "click sin mutación" ->
 * heal inútil (FIX #5).
 */
import { describe, expect, it } from "vitest";
import { snapshotStateKey } from "../pipeline.js";
import type { ObserverSnapshot } from "../types.js";

function makeSnapshot(treeMarkdown: string, nodeCount: number): ObserverSnapshot {
  return {
    url: "https://app.test/notes",
    title: "Notas",
    capturedAt: "2026-07-10T00:00:00.000Z",
    treeMarkdown,
    nodeCount,
    pageErrors: [],
  };
}

describe("snapshotStateKey (FIX #5 — firma sensible a cambios más allá de 1200 chars)", () => {
  it("distingue dos árboles idénticos en los primeros 1200 chars pero distintos después", () => {
    // Prefijo común de 1300 chars (> 1200): el corte viejo (.slice(0, 1200)) los
    // veía idénticos. Misma longitud y mismo nodeCount para aislar el hash del
    // contenido: solo distinguir el árbol COMPLETO detecta la diferencia.
    const commonPrefix = "x".repeat(1300);
    const a = makeSnapshot(`${commonPrefix}aaa`, 5);
    const b = makeSnapshot(`${commonPrefix}bbb`, 5);

    const keyA = snapshotStateKey(a);
    const keyB = snapshotStateKey(b);

    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyA).not.toBe(keyB);
  });

  it("produce la misma firma para snapshots idénticos (determinista)", () => {
    const tree = "y".repeat(2000);
    expect(snapshotStateKey(makeSnapshot(tree, 7))).toBe(snapshotStateKey(makeSnapshot(tree, 7)));
  });

  it("devuelve undefined sin snapshot", () => {
    expect(snapshotStateKey(undefined)).toBeUndefined();
  });
});
