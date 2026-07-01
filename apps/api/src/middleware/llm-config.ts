import type { Context, Next } from "hono";
import { runWithLlmConfigAsync } from "../llm/context.js";
import { settingsToResolvedConfig } from "../llm/user-config.js";
import { getUserLlmSettings } from "../store/llm-settings.js";

/** Inyecta la config LLM del usuario en el contexto async de la request. */
export async function attachUserLlmMiddleware(c: Context, next: Next) {
  const user = c.get("user");
  if (!user?.id) return next();

  const stored = await getUserLlmSettings(user.id);
  const config = settingsToResolvedConfig(stored);
  return runWithLlmConfigAsync(config, () => next());
}
