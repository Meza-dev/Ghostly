import { runFlow, safeParseRunInput } from "@ghosttester/runner";
import type { AssistedMeta, RunRecord, Step } from "@ghosttester/runner";
import { z } from "zod";
import { Hono } from "hono";
import { loadConfig } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { redactAssistedMeta } from "../lib/redact-assist.js";
import { projectExistsForUser } from "../store/projects.js";
import { getAllRuns, getRun, saveRun } from "../store/runs.js";

export const runRouter = new Hono();
const appConfig = loadConfig();

const assistedMetaSchema: z.ZodType<AssistedMeta> = z.object({
  goal: z.string().min(1),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  promptVersion: z.string().min(1),
});

function summarizeStepForLog(step: Step): Record<string, unknown> {
  if (step.action === "fill") {
    return {
      action: step.action,
      selector: step.selector,
      value: "[REDACTED]",
    };
  }
  if (step.action === "goto") {
    return { action: step.action, url: step.url };
  }
  if (step.action === "waitForSelector") {
    return {
      action: step.action,
      selector: step.selector,
      ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
    };
  }
  if (step.action === "click") {
    return { action: step.action, selector: step.selector };
  }
  if (step.action === "press") {
    return { action: step.action, key: step.key };
  }
  return { action: step.action };
}

runRouter.use("/runs*", authMiddleware);
runRouter.use("/run", authMiddleware);

runRouter.get("/runs", async (c) => {
  const user = c.get("user");
  const project = c.req.query("project");
  const runs = await getAllRuns(user.id, project ?? undefined);
  return c.json(runs);
});

runRouter.get("/runs/:id", async (c) => {
  const user = c.get("user");
  const record = await getRun(c.req.param("id"), user.id);
  if (!record) return c.json({ ok: false, error: "not found" }, 404);
  return c.json(record);
});

runRouter.post("/run", async (c) => {
  const user = c.get("user");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  const parsed = safeParseRunInput(body, {
    maxSteps: appConfig.assist.maxSteps,
    maxTimeoutMs: appConfig.assist.maxTimeoutMs,
    enforceSameOrigin: true,
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: "validación", details: parsed.error.flatten() }, 400);
  }

  const project = typeof body.project === "string" ? body.project.trim() : "";
  if (!project) {
    return c.json({ ok: false, error: "project requerido" }, 400);
  }
  const projectIsValid = await projectExistsForUser(project, user.id);
  if (!projectIsValid) {
    return c.json({ ok: false, error: "project inválido" }, 400);
  }

  let assisted: AssistedMeta | undefined;
  if (body.assisted !== undefined) {
    const parsedAssisted = assistedMetaSchema.safeParse(body.assisted);
    if (!parsedAssisted.success) {
      return c.json({ ok: false, error: "assisted inválido", details: parsedAssisted.error.flatten() }, 400);
    }
    assisted = redactAssistedMeta(parsedAssisted.data);
  }
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  if (assisted) {
    // eslint-disable-next-line no-console
    console.log("[assist-run] Inicio de ejecución asistida", {
      runId: id,
      userId: user.id,
      project,
      baseUrl: parsed.data.baseUrl,
      steps: parsed.data.steps.length,
      model: assisted.model,
      goal: assisted.goal,
    });
    // eslint-disable-next-line no-console
    console.log(
      "[assist-run] Plan paso a paso",
      parsed.data.steps.map((step, index) => ({
        index: index + 1,
        ...summarizeStepForLog(step),
      })),
    );
  }

  try {
    const result = await runFlow(parsed.data);
    const record: RunRecord = {
      id,
      status: result.ok ? "pass" : "fail",
      startedAt,
      durationMs: result.durationMs,
      baseUrl: parsed.data.baseUrl,
      project,
      ...(assisted ? { assisted } : {}),
      steps: result.steps,
      ...(result.videoPath !== undefined ? { videoPath: result.videoPath } : {}),
    };
    await saveRun(record, user.id);
    if (assisted) {
      // eslint-disable-next-line no-console
      console.log("[assist-run] Ejecución asistida finalizada", {
        runId: id,
        status: record.status,
        durationMs: record.durationMs,
        totalSteps: record.steps.length,
        failedSteps: record.steps.filter((step) => !step.ok).length,
      });
    }
    return c.json(record, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (assisted) {
      // eslint-disable-next-line no-console
      console.error("[assist-run] Error en ejecución asistida", {
        runId: id,
        message,
      });
    }
    return c.json({ ok: false, error: "runner", message }, 500);
  }
});
