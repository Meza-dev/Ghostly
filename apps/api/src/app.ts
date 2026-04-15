import { Hono } from "hono";
import { runRouter } from "./routes/run.js";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/v1/ping", (c) =>
    c.json({
      ok: true,
      service: "ghosttester-api",
      env: process.env.NODE_ENV ?? "development",
    }),
  );

  app.route("/v1", runRouter);

  return app;
}
