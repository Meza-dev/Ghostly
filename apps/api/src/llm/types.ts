export type LlmMessage = { role: "system" | "user"; content: string };

/**
 * Evidencia visual opcional adjunta a la request (spec §4.3 — "híbrido según
 * provider"). Solo los providers HTTP con `supportsImages: true` en el
 * catálogo la usan; el dossier de texto (`messages`) es siempre autosuficiente
 * — la imagen es evidencia EXTRA, nunca la única fuente. Providers CLI la
 * ignoran (nunca la reciben: gating ocurre antes de invocar `complete`).
 */
export type LlmImageAttachment = {
  /** Datos crudos en base64 (sin prefijo `data:`). */
  base64: string;
  /** Ej. `image/png`. */
  mimeType: string;
};

export type LlmCompleteRequest = {
  messages: LlmMessage[];
  model?: string;
  timeoutMs: number;
  jsonMode?: boolean;
  label?: string;
  /** Adjunta la imagen al último mensaje de rol `user`. Solo HTTP + provider con `supportsImages`. */
  image?: LlmImageAttachment;
};

export type LlmCompleteResult = {
  rawText: string;
  usage?: Record<string, unknown>;
  providerId: string;
  elapsedMs: number;
};

export interface LlmProvider {
  readonly providerId: string;
  isAvailable(): Promise<boolean>;
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
}
