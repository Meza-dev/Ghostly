import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { authRouter } from "./routes/auth.js";
import { planRouter } from "./routes/plan.js";
import { projectsRouter } from "./routes/projects.js";
import { runRouter } from "./routes/run.js";
import { runEventsRouter } from "./routes/run-events.js";

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

  app.get("/v1/ping", (c) =>
    c.json({
      ok: true,
      service: "ghostly-api",
      env: process.env.NODE_ENV ?? "development",
      assistConfigured: Boolean(
        process.env.OPENAI_API_KEY?.trim() || process.env.ASSIST_LLM_API_KEY?.trim(),
      ),
    }),
  );

  app.route("/v1", runRouter);
  app.route("/v1", runEventsRouter);
  app.route("/v1", planRouter);
  app.route("/v1", projectsRouter);
  app.route("/v1", apiKeysRouter);

  app.get("/artifacts/*", async (c) => {
    const relative = c.req.path.replace(/^\/artifacts\//, "");
    const filePath = resolve(ARTIFACTS_ROOT, relative);
    try {
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      return new Response(data, { headers: { "Content-Type": mime } });
    } catch {
      return c.json({ ok: false, error: "not found" }, 404);
    }
  });

  // Servir el frontend estático cuando el CLI levanta el servidor empaquetado.
  // GHOST_WEB_DIR apunta a la carpeta dist/assets/web del CLI instalado.
  const webDir = process.env.GHOST_WEB_DIR;
  if (webDir && existsSync(webDir)) {
    app.get("*", async (c) => {
      let reqPath = c.req.path;
      // Eliminar la barra inicial para resolver la ruta correctamente
      const relative = reqPath.startsWith("/") ? reqPath.slice(1) : reqPath;
      let filePath = resolve(webDir, relative);

      // Si no existe o es directorio, servir index.html (SPA fallback)
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
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
