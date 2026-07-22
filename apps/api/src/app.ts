import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { containedPath } from "./lib/contained-path.js";
import { llmSettingsRouter } from "./routes/llm-settings.js";
import { attachUserLlmMiddleware } from "./middleware/llm-config.js";
import { runWithLlmConfigAsync } from "./llm/context.js";
import { settingsToResolvedConfig } from "./llm/user-config.js";
import { getUserLlmSettings } from "./store/llm-settings.js";
import { getLlmDisplayModel, getLlmProviderId, isLlmProviderConfigured } from "./llm/client.js";
import { authMiddleware } from "./middleware/auth.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { authRouter } from "./routes/auth.js";
import { planRouter } from "./routes/plan.js";
import { projectsRouter } from "./routes/projects.js";
import { runRouter } from "./routes/run.js";
import { runEventsRouter } from "./routes/run-events.js";
import { fetchLatestVersion, getCurrentVersion, isNewerVersion, UPDATE_EXIT_CODE } from "./services/updater.js";

const ARTIFACTS_ROOT = resolve(process.cwd(), "artifacts");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Api-Key"] }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Rutas públicas (sin auth)
  app.route("/v1", authRouter);

  // Guard simple por API Key de Ghostly para todo /v1/*
  app.use("/v1/*", apiKeyMiddleware);

  // Rutas protegidas
  app.use("/v1/*", async (c, next) => {
    // Excluir login del middleware
    if (c.req.path === "/v1/auth/login") return next();
    return authMiddleware(c, next);
  });

  app.get("/v1/ping", async (c) => {
    const user = c.get("user");
    const stored = user ? await getUserLlmSettings(user.id) : null;
    const config = settingsToResolvedConfig(stored);
    return runWithLlmConfigAsync(config, async () => {
      // Chequeo barato (sin probe en vivo): el modal solo necesita saber si hay
      // una IA configurada, no si está disponible ahora mismo (GHOST perf).
      const configured = isLlmProviderConfigured();
      return c.json({
        ok: true,
        service: "ghostly-api",
        env: process.env.NODE_ENV ?? "development",
        assistConfigured: configured,
        llm: {
          provider: getLlmProviderId(),
          model: getLlmDisplayModel(),
          available: configured,
          source: stored ? "user" : "env",
        },
      });
    });
  });

  // Auto-update (MVP): estado de versión + disparo del npm install. No necesitan
  // la config de LLM, por eso van antes de attachUserLlmMiddleware.
  app.get("/v1/version", async (c) => {
    const current = getCurrentVersion();
    const latest = await fetchLatestVersion();
    return c.json({
      current,
      latest,
      updateAvailable: Boolean(current && latest && isNewerVersion(latest, current)),
    });
  });

  app.post("/v1/update", (c) => {
    // El update NO puede correr en este proceso: en Windows npm no puede
    // renombrar el paquete global mientras este server (y los MCP servers de
    // los editores) lo tienen lockeado → EBUSY. Contrato: salir con código 75
    // y `ghostly up` (el padre) orquesta kill de procesos residuales +
    // npm install + relanzamiento del server.
    if (!getCurrentVersion()) {
      return c.json({ ok: false, error: "self-update is only available when running under ghostly up" }, 400);
    }
    setTimeout(() => process.exit(UPDATE_EXIT_CODE), 300);
    return c.json({ ok: true, scheduled: true });
  });

  app.use("/v1/*", attachUserLlmMiddleware);

  app.route("/v1", runRouter);
  app.route("/v1", runEventsRouter);
  app.route("/v1", planRouter);
  app.route("/v1", projectsRouter);
  app.route("/v1", apiKeysRouter);
  app.route("/v1", llmSettingsRouter);

  // Artefactos (C3): exigir autenticación (fuera de la cadena /v1/*, antes
  // no tenían ningún guard) y contener la ruta bajo ARTIFACTS_ROOT.
  app.use("/artifacts/*", apiKeyMiddleware);
  app.use("/artifacts/*", authMiddleware);
  app.get("/artifacts/*", async (c) => {
    const relative = c.req.path.replace(/^\/artifacts\//, "");
    const filePath = containedPath(ARTIFACTS_ROOT, relative);
    if (!filePath) {
      return c.json({ ok: false, error: "not found" }, 404);
    }
    try {
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "Content-Type": mime, "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return c.json({ ok: false, error: "not found" }, 404);
    }
  });

  // Servir el frontend estático cuando el CLI levanta el servidor empaquetado.
  // GHOST_WEB_DIR apunta a la carpeta dist/assets/web del CLI instalado.
  const webDir = process.env.GHOST_WEB_DIR;
  if (webDir && existsSync(webDir)) {
    app.get("*", async (c) => {
      const reqPath = c.req.path;
      // Eliminar la barra inicial para resolver la ruta correctamente
      const relative = reqPath.startsWith("/") ? reqPath.slice(1) : reqPath;
      // Contención (C3): si la ruta escapa de webDir, no existe o es directorio,
      // caer al SPA fallback (index.html) en vez de servir el archivo externo.
      let filePath = containedPath(webDir, relative);
      if (!filePath || statSync(filePath).isDirectory()) {
        filePath = resolve(webDir, "index.html");
      }

      try {
        const data = await readFile(filePath);
        const mime = MIME[extname(filePath)] ?? "text/html; charset=utf-8";
        return new Response(data, { headers: { "Content-Type": mime } });
      } catch {
        return c.text("Not found", 404);
      }
    });
  }

  return app;
}
