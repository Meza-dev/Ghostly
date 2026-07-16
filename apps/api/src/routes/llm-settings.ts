import { Hono } from "hono";
import { z } from "zod";
import { LLM_PROVIDER_CATALOG, getCatalogEntry, isModelAllowed } from "../llm/catalog.js";
import { invalidateLlmProviderCache, isLlmConfigured } from "../llm/client.js";
import { runWithLlmConfigAsync } from "../llm/context.js";
import { listCursorCliModels } from "../llm/list-cli-models.js";
import {
  getLlmStatus,
  maskApiKey,
  settingsToResolvedConfig,
} from "../llm/user-config.js";
import { authMiddleware } from "../middleware/auth.js";
import { getUserLlmSettings, upsertUserLlmSettings } from "../store/llm-settings.js";

export const llmSettingsRouter = new Hono();

llmSettingsRouter.use("/settings/llm*", authMiddleware);

llmSettingsRouter.get("/settings/llm/providers", (c) => {
  return c.json({
    ok: true,
    providers: LLM_PROVIDER_CATALOG.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      description: p.description,
      needsApiKey: p.needsApiKey,
      needsBaseUrl: p.needsBaseUrl,
      defaultBaseUrl: p.defaultBaseUrl ?? null,
      defaultModel: p.defaultModel,
      supportsAutoModel: p.supportsAutoModel,
      supportsLiveModels: p.supportsLiveModels ?? false,
      modelOptions: p.modelOptions,
    })),
  });
});

llmSettingsRouter.get("/settings/llm/models", async (c) => {
  const providerId = c.req.query("providerId")?.trim() || "cursor-cli";
  const catalog = getCatalogEntry(providerId);
  if (!catalog?.supportsLiveModels) {
    return c.json({
      ok: true,
      providerId,
      models: catalog?.modelOptions ?? [],
      source: "static" as const,
    });
  }

  const user = c.get("user");
  const stored = await getUserLlmSettings(user.id);
  const config = settingsToResolvedConfig(stored);

  const listed = await runWithLlmConfigAsync(config, () => listCursorCliModels(config));
  return c.json({
    ok: true,
    providerId,
    models: listed.models,
    source: listed.source,
    ...(listed.message ? { message: listed.message } : {}),
  });
});

llmSettingsRouter.get("/settings/llm", async (c) => {
  const user = c.get("user");
  const stored = await getUserLlmSettings(user.id);
  const catalog = stored ? getCatalogEntry(stored.providerId) : null;
  const config = settingsToResolvedConfig(stored);

  const source = stored ? ("user" as const) : ("env" as const);
  const status = await runWithLlmConfigAsync(config, () => getLlmStatus(config, source));
  const apiKey = maskApiKey(stored?.apiKey);

  return c.json({
    ok: true,
    settings: stored
      ? {
          providerId: stored.providerId,
          model: stored.model,
          baseUrl: stored.baseUrl ?? catalog?.defaultBaseUrl ?? null,
          apiKeyConfigured: apiKey.configured,
          apiKeyHint: apiKey.hint ?? null,
        }
      : null,
    status,
    envFallback: Boolean(!stored && (await isLlmConfigured())),
  });
});

const saveSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  clearApiKey: z.boolean().optional(),
});

llmSettingsRouter.put("/settings/llm", async (c) => {
  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "validación", details: parsed.error.flatten() }, 400);
  }

  const catalog = getCatalogEntry(parsed.data.providerId);
  if (!catalog) {
    return c.json({ ok: false, error: "proveedor desconocido" }, 400);
  }

  // Allow-list del campo `model` (C1): rechaza espacios/metacaracteres de shell
  // y argument-injection antes de que el valor llegue al spawn del proveedor CLI.
  if (!isModelAllowed(catalog, parsed.data.model)) {
    return c.json({ ok: false, error: "modelo no permitido para este proveedor" }, 400);
  }

  const existing = await getUserLlmSettings(user.id);
  let apiKey = existing?.apiKey;
  if (parsed.data.clearApiKey) {
    apiKey = undefined;
  } else if (parsed.data.apiKey?.trim()) {
    apiKey = parsed.data.apiKey.trim();
  }

  if (catalog.needsApiKey && !apiKey?.trim()) {
    return c.json({ ok: false, error: "API key requerida para este proveedor" }, 400);
  }

  const baseUrl =
    parsed.data.baseUrl?.trim() ||
    (catalog.needsBaseUrl ? catalog.defaultBaseUrl : undefined);

  if (catalog.needsBaseUrl && !baseUrl) {
    return c.json({ ok: false, error: "Base URL requerida" }, 400);
  }

  const record = {
    providerId: catalog.id,
    model: parsed.data.model.trim() || catalog.defaultModel,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };

  await upsertUserLlmSettings(user.id, record);
  invalidateLlmProviderCache();

  const config = settingsToResolvedConfig(record);
  const status = await runWithLlmConfigAsync(config, () => getLlmStatus(config, "user"));
  const masked = maskApiKey(record.apiKey);

  return c.json({
    ok: true,
    settings: {
      providerId: record.providerId,
      model: record.model,
      baseUrl: record.baseUrl ?? null,
      apiKeyConfigured: masked.configured,
      apiKeyHint: masked.hint ?? null,
    },
    status,
  });
});

llmSettingsRouter.post("/settings/llm/test", async (c) => {
  const user = c.get("user");
  const stored = await getUserLlmSettings(user.id);
  const config = settingsToResolvedConfig(stored);
  const source = stored ? ("user" as const) : ("env" as const);
  const status = await runWithLlmConfigAsync(config, () => getLlmStatus(config, source));
  return c.json({ ok: true, status });
});
