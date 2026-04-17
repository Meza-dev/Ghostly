import { Hono } from "hono";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { AssistPlanError, generateAssistPlan } from "../services/assist-plan.js";
import { projectExistsForUser } from "../store/projects.js";

const planRequestSchema = z.object({
  project: z.string().min(1),
  baseUrl: z.string().url(),
  goal: z.string().min(1),
});

const appConfig = loadConfig();

export const planRouter = new Hono();

planRouter.post("/plan", async (c) => {
  if (!appConfig.assist.enabled) {
    return c.json({ ok: false, error: "not found" }, 404);
  }

  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }

  const parsedReq = planRequestSchema.safeParse(body);
  if (!parsedReq.success) {
    return c.json({ ok: false, error: "validación", details: parsedReq.error.flatten() }, 400);
  }

  const project = parsedReq.data.project.trim();
  const goal = parsedReq.data.goal.trim();
  // eslint-disable-next-line no-console
  console.log("[assist-plan] Solicitud recibida", {
    userId: user.id,
    project,
    baseUrl: parsedReq.data.baseUrl,
    goalLength: goal.length,
  });
  if (goal.length > appConfig.assist.maxGoalChars) {
    return c.json(
      { ok: false, error: `goal excede el máximo permitido (${appConfig.assist.maxGoalChars})` },
      400,
    );
  }

  const projectIsValid = await projectExistsForUser(project, user.id);
  if (!projectIsValid) {
    return c.json({ ok: false, error: "project inválido" }, 400);
  }

  try {
    const result = await generateAssistPlan({
      goal,
      baseUrl: parsedReq.data.baseUrl,
      maxSteps: appConfig.assist.maxSteps,
      maxTimeoutMs: appConfig.assist.maxTimeoutMs,
      timeoutMs: appConfig.assist.llmTimeoutMs,
    });
    // eslint-disable-next-line no-console
    console.log("[assist-plan] Plan enviado al cliente", {
      userId: user.id,
      project,
      steps: result.draft.steps.length,
      model: result.meta.model,
    });
    return c.json({ ok: true, draft: result.draft, meta: result.meta }, 200);
  } catch (error) {
    if (error instanceof AssistPlanError) {
      // eslint-disable-next-line no-console
      console.log("[assist-plan] Error controlado al generar plan", {
        userId: user.id,
        project,
        status: error.status,
        message: error.message,
      });
      if (error.status === 400) return c.json({ ok: false, error: error.message }, 400);
      if (error.status === 504) return c.json({ ok: false, error: error.message }, 504);
      return c.json({ ok: false, error: error.message }, 502);
    }
    // eslint-disable-next-line no-console
    console.error("[assist-plan] Error inesperado al generar plan", {
      userId: user.id,
      project,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ ok: false, error: "Error interno al generar plan" }, 500);
  }
});
