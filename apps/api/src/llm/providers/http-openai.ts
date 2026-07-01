import type { ResolvedLlmConfig } from "../config.js";
import { LlmError } from "../errors.js";
import { parseOpenAiAssistantContent } from "../extract-json.js";
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from "../types.js";

export class HttpOpenAiProvider implements LlmProvider {
  readonly providerId = "http";

  constructor(private readonly config: ResolvedLlmConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.endpoint && this.config.apiKey);
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model ?? this.config.model,
          temperature: 0,
          response_format: req.jsonMode !== false ? { type: "json_object" } : undefined,
          messages: req.messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new LlmError(
          `HTTP ${response.status}: ${errBody.slice(0, 300)}`,
          502,
          this.providerId,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: Record<string, unknown>;
      };
      const rawText = parseOpenAiAssistantContent(payload.choices?.[0]?.message?.content);
      if (!rawText) {
        throw new LlmError("Respuesta HTTP vacía", 502, this.providerId);
      }

      return {
        rawText,
        usage: payload.usage,
        providerId: this.providerId,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new LlmError("Timeout al consultar proveedor HTTP", 504, this.providerId);
      }
      throw new LlmError(
        error instanceof Error ? error.message : String(error),
        502,
        this.providerId,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
