export type LlmMessage = { role: "system" | "user"; content: string };

export type LlmCompleteRequest = {
  messages: LlmMessage[];
  model?: string;
  timeoutMs: number;
  jsonMode?: boolean;
  label?: string;
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
