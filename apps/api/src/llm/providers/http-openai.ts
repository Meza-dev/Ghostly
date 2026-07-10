import type { ResolvedLlmConfig } from "../config.js";
import { LlmError } from "../errors.js";
import { parseOpenAiAssistantContent } from "../extract-json.js";
import type { LlmCompleteRequest, LlmCompleteResult, LlmMessage, LlmProvider } from "../types.js";

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAiChatMessage = { role: LlmMessage["role"]; content: string | OpenAiContentPart[] };

/**
 * Adjunta la imagen (si viene) como un content-part `image_url` al ÚLTIMO
 * mensaje de rol `user` (spec §4.3 — el screenshot es evidencia EXTRA sobre el
 * dossier de texto, nunca reemplaza a `messages`). Si no hay ningún mensaje
 * `user`, la imagen se descarta silenciosamente en vez de fallar la request.
 */
function buildOpenAiMessages(req: LlmCompleteRequest): OpenAiChatMessage[] {
  if (!req.image) return req.messages;
  const lastUserIndex = req.messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex < 0) return req.messages;
  return req.messages.map((m, i): OpenAiChatMessage => {
    if (i !== lastUserIndex) return m;
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        { type: "image_url", image_url: { url: `data:${req.image!.mimeType};base64,${req.image!.base64}` } },
      ],
    };
  });
}

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
          messages: buildOpenAiMessages(req),
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
