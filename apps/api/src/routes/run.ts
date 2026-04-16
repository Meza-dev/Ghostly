import { runFlow, runInputSchema } from "@ghosttester/runner";
import type { RunRecord } from "@ghosttester/runner";
import { Hono } from "hono";
import { getAllRuns, getRun, saveRun } from "../store/runs.js";

export const runRouter = new Hono();

runRouter.get("/runs", async (c) => {
  const project = c.req.query("project");
  const runs = await getAllRuns(project ?? undefined);
  return c.json(runs);
});

runRouter.get("/runs/:id", async (c) => {
  const record = await getRun(c.req.param("id"));
  if (!record) return c.json({ ok: false, error: "not found" }, 404);
  return c.json(record);
});

runRouter.post("/run", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  const parsed = runInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "validación", details: parsed.error.flatten() },
      400,
    );
  }

  const project = typeof body.project === "string" && body.project ? body.project : undefined;

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const result = await runFlow(parsed.data);
    const record: RunRecord = {
      id,
      status: result.ok ? "pass" : "fail",
      startedAt,
      durationMs: result.durationMs,
      baseUrl: parsed.data.baseUrl,
      ...(project ? { project } : {}),
      steps: result.steps,
      ...(result.videoPath !== undefined ? { videoPath: result.videoPath } : {}),
    };
    await saveRun(record);
    return c.json(record, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: "runner", message }, 500);
  }
});
