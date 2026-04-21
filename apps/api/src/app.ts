import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
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
};

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Api-Key"] }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Rutas públicas (sin auth)
  app.route("/v1", authRouter);

  // Rutas protegidas
  app.use("/v1/*", async (c, next) => {
    // Excluir login del middleware
    if (c.req.path === "/v1/auth/login") return next();
    return authMiddleware(c, next);
  });

  app.get("/v1/ping", (c) =>
    c.json({ ok: true, service: "ghosttester-api", env: process.env.NODE_ENV ?? "development" }),
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

  return app;
}
