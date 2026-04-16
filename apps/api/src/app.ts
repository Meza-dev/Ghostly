import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { projectsRouter } from "./routes/projects.js";
import { runRouter } from "./routes/run.js";

// artifacts/ relativo al CWD del proceso (donde corre tsx/node)
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

  app.use("*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/v1/ping", (c) =>
    c.json({
      ok: true,
      service: "ghosttester-api",
      env: process.env.NODE_ENV ?? "development",
    }),
  );

  app.route("/v1", runRouter);
  app.route("/v1", projectsRouter);

  // Sirve archivos de artifacts/ usando el CWD real del proceso
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
