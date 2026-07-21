import { Hono } from "hono";
import { z } from "zod";
import { captureRecon } from "@ghostly-io/runner";
import type { PlannedStep } from "@ghostly-io/runner";
import { loadConfig } from "../config.js";
import { getLlmDisplayModel } from "../llm/client.js";
import { AssistPlanError, generateAssistPlan } from "../services/assist-plan.js";
import { buildTargetUnreachableMessage, isTargetUnreachableError } from "../lib/target-unreachable.js";
import { createStrategist } from "../services/assist-orchestrator.js";
import { projectExistsForUser } from "../store/projects.js";
import { msg, pickLang } from "../i18n/pick.js";

const planRequestSchema = z.object({
  project: z.string().min(1),
  baseUrl: z.string().url(),
  goal: z.string().min(1),
  mode: z.enum(["v1", "v2"]).optional(),
});

const appConfig = loadConfig();

export const planRouter = new Hono();

planRouter.post("/plan", async (c) => {
  const lang = pickLang(c.req.header("Accept-Language"));
  if (!appConfig.assist.enabled) {
    return c.json({ ok: false, error: msg("common.notFound", lang) }, 404);
  }

  const user = c.get("user");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: msg("common.invalidJsonBody", lang) }, 400);
  }

  const parsedReq = planRequestSchema.safeParse(body);
  if (!parsedReq.success) {
    return c.json({ ok: false, error: msg("common.validationError", lang), details: parsedReq.error.flatten() }, 400);
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
      { ok: false, error: msg("plan.goalTooLong", lang, { max: appConfig.assist.maxGoalChars }) },
      400,
    );
  }

  const projectIsValid = await projectExistsForUser(project, user.id);
  if (!projectIsValid) {
    return c.json({ ok: false, error: msg("plan.invalidProject", lang) }, 400);
  }

  const mode = parsedReq.data.mode ?? "v1";
  if (mode === "v2" && !appConfig.assistV2.enabled) {
    return c.json({ ok: false, error: msg("plan.assistV2Disabled", lang) }, 409);
  }

  try {
    if (mode === "v2") {
      // eslint-disable-next-line no-console
      console.log("[assist-plan v2] Recon+plan iniciado", {
        userId: user.id,
        project,
        baseUrl: parsedReq.data.baseUrl,
      });
      let snapshot;
      try {
        snapshot = await captureRecon(parsedReq.data.baseUrl, {
          headless: true,
          observerMaxNodes: appConfig.assistV2.observerMaxNodes,
        });
      } catch (reconError) {
        const detail = reconError instanceof Error ? reconError.message : String(reconError);
        if (isTargetUnreachableError(detail)) {
          // Detalle técnico crudo al log del servidor; al usuario le llega el mensaje claro.
          // eslint-disable-next-line no-console
          console.error("[assist-plan v2] Recon no pudo alcanzar la app objetivo", {
            userId: user.id,
            project,
            baseUrl: parsedReq.data.baseUrl,
            error: detail,
          });
          throw new AssistPlanError(buildTargetUnreachableMessage(parsedReq.data.baseUrl, lang), 502);
        }
        throw reconError;
      }
      const strategist = createStrategist({
        llmTimeoutMs: appConfig.assist.llmTimeoutMs,
        chunkSize: appConfig.assistV2.chunkSize,
        lang,
      });
      const chunk = await strategist({
        goal,
        baseUrl: parsedReq.data.baseUrl,
        snapshot,
        history: [],
        maxSteps: appConfig.assistV2.chunkSize,
      });
      const meta = {
        goal,
        model: getLlmDisplayModel(),
        generatedAt: new Date().toISOString(),
        promptVersion: "assist-v2-recon",
      };
      return c.json(
        {
          ok: true,
          mode: "v2" as const,
          draft: {
            baseUrl: parsedReq.data.baseUrl,
            steps: chunk.steps.map((s: PlannedStep) => s.step),
          },
          meta,
          observer: snapshot,
        },
        200,
      );
    }
    const result = await generateAssistPlan({
      goal,
      baseUrl: parsedReq.data.baseUrl,
      maxSteps: appConfig.assist.maxSteps,
      maxTimeoutMs: appConfig.assist.maxTimeoutMs,
      timeoutMs: appConfig.assist.llmTimeoutMs,
      lang,
    });
    // eslint-disable-next-line no-console
    console.log("[assist-plan] Plan enviado al cliente", {
      userId: user.id,
      project,
      steps: result.draft.steps.length,
      model: result.meta.model,
    });
    return c.json({ ok: true, draft: result.draft, meta: result.meta, mode: "v1" as const }, 200);
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
    return c.json({ ok: false, error: msg("plan.internalError", lang) }, 500);
  }
});
