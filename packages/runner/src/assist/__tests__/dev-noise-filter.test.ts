/**
 * Filtro de ruido de dev-tooling (Kanon GHOST-66) — RED baseline.
 *
 * Errores de consola benignos de herramientas de desarrollo (HMR de webpack,
 * react refresh, vite) NO deben disparar el trigger `error-signal` del juez,
 * pero SÍ deben seguir capturándose como contexto (snapshot/dossier). Lista
 * de patrones conservadora e inequívoca — cualquier otro error mantiene el
 * comportamiento actual.
 */
import { describe, expect, it } from "vitest";
import { isKnownDevNoiseError } from "../observer.js";
import { detectUnresolvedWarningSignal } from "../pipeline.js";
import type { PageError } from "../types.js";

const HMR_WS_MESSAGE = "WebSocket connection to 'wss://central-dev.example.com:3000/ws' failed:";

function consoleWarning(message: string, observedAtStep: number): PageError {
  return { source: "console", severity: "warning", message, observedAtStep };
}

describe("isKnownDevNoiseError (GHOST-66 — dev-tooling noise)", () => {
  it("classifies the webpack HMR WebSocket failure as noise", () => {
    expect(isKnownDevNoiseError(HMR_WS_MESSAGE)).toBe(true);
  });

  it("classifies sockjs-node / vite HMR websocket failures as noise", () => {
    expect(isKnownDevNoiseError("WebSocket connection to 'http://localhost/sockjs-node' failed")).toBe(true);
    expect(isKnownDevNoiseError("WebSocket connection to 'ws://localhost:5173/__vite_hmr' failed")).toBe(true);
    expect(isKnownDevNoiseError("WebSocket connection to 'ws://localhost:5173/@vite/client' failed")).toBe(true);
  });

  it("classifies [HMR] / [webpack-dev-server] / react refresh messages as noise", () => {
    expect(isKnownDevNoiseError("[HMR] Waiting for update signal from WDS...")).toBe(true);
    expect(isKnownDevNoiseError("[webpack-dev-server] Disconnected!")).toBe(true);
    expect(isKnownDevNoiseError("React Refresh runtime error")).toBe(true);
  });

  it("does NOT classify genuine errors or unrelated websocket failures as noise", () => {
    expect(isKnownDevNoiseError("TypeError: Cannot read properties of undefined")).toBe(false);
    expect(isKnownDevNoiseError("WebSocket connection to 'wss://api.example.com/chat' failed")).toBe(false);
    expect(isKnownDevNoiseError("GET /notes → 404")).toBe(false);
  });
});

describe("detectUnresolvedWarningSignal excludes dev-tooling noise (GHOST-66)", () => {
  it("does NOT trigger for the webpack HMR WebSocket warning", () => {
    const result = detectUnresolvedWarningSignal([consoleWarning(HMR_WS_MESSAGE, 2)], 2, new Set());
    expect(result).toBeUndefined();
  });

  it("still triggers for a genuine console error warning", () => {
    const err = consoleWarning("TypeError: Cannot read properties of undefined", 2);
    const result = detectUnresolvedWarningSignal([err], 2, new Set());
    expect(result).toEqual([err]);
  });

  it("triggers only with the genuine error when noise and genuine coexist", () => {
    const genuine = consoleWarning("TypeError: Cannot read properties of undefined", 2);
    const result = detectUnresolvedWarningSignal([consoleWarning(HMR_WS_MESSAGE, 2), genuine], 2, new Set());
    expect(result).toEqual([genuine]);
  });

  it("keeps noise errors in the input list untouched (captured as context, not dropped)", () => {
    const errors = [consoleWarning(HMR_WS_MESSAGE, 2)];
    detectUnresolvedWarningSignal(errors, 2, new Set());
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe(HMR_WS_MESSAGE);
  });
});
