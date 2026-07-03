import { runAssistedFlow, runFlow, safeParseRunInput } from "@ghostly-io/runner";
import type {
  AssistEvent,
  AssistedMeta,
  AssistedRunInput,
  CodeHints,
  Step,
  StepOutcome,
} from "@ghostly-io/runner";
import { z } from "zod";
import { Hono } from "hono";
import { loadConfig } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { redactAssistedMeta } from "../lib/redact-assist.js";
import { createHealer, createStrategist } from "../services/assist-orchestrator.js";
import { runControlRegistry } from "../services/run-control.js";
import { runEventBus } from "../services/run-event-bus.js";
import { projectExistsForUser } from "../store/projects.js";
import {
  appendRunEvent,
  createRunningRun,
  finalizeRun,
  getAssistMemory,
  getAllRuns,
  getRun,
  upsertAssistMemory,
} from "../store/runs.js";

export const runRouter = new Hono();
const appConfig = loadConfig();

const assistedMetaSchema: z.ZodType<AssistedMeta> = z.object({
  goal: z.string().min(1),
  model: z.string().min(1),
  generatedAt: z.string().datetime(),
  promptVersion: z.string().min(1),
});

const assistV2Schema = z.object({
  v2: z.literal(true),
  goal: z.string().min(1),
  isFullPlan: z.boolean().optional(),
  maxHealingAttemptsPerStep: z.number().int().min(0).max(3).optional(),
  observerMaxNodes: z.number().int().min(50).max(1000).optional(),
  victory: z
    .object({
      textIncludes: z.array(z.string().min(1)).max(10).optional(),
      selectorVisible: z.array(z.string().min(1)).max(10).optional(),
      urlIncludes: z.array(z.string().min(1)).max(10).optional(),
      mustAll: z.boolean().optional(),
      revalidate: z.boolean().optional(),
    })
    .optional(),
  maxHorizons: z.number().int().min(1).max(50).optional(),
  stepsPerHorizon: z.number().int().min(1).max(10).optional(),
  maxLoopMs: z.number().int().min(10_000).max(3_600_000).optional(),
  modalLoaderMaxWaitMs: z.number().int().min(3_000).max(600_000).optional(),
  memoryMode: z.enum(["off", "runtime", "adaptive"]).optional(),
});

const codeHintsSchema: z.ZodType<CodeHints> = z.object({
  components: z.array(z.object({
    name: z.string().min(1),
    file: z.string().min(1).optional(),
    testIds: z.array(z.string().min(1)).optional(),
    ariaLabels: z.array(z.string().min(1)).optional(),
    roles: z.array(z.string().min(1)).optional(),
  })).optional(),
  forms: z.array(z.object({
    name: z.string().min(1),
    file: z.string().min(1).optional(),
    inputs: z.array(z.object({
      testId: z.string().min(1).optional(),
      ariaLabel: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
    })).optional(),
    submitTestId: z.string().min(1).optional(),
    submitLabel: z.string().min(1).optional(),
  })).optional(),
  routes: z.array(z.object({
    path: z.string().min(1),
    component: z.string().min(1).optional(),
  })).optional(),
  selectors: z.object({
    byTestId: z.record(z.string()).optional(),
    byAriaLabel: z.record(z.string()).optional(),
  }).optional(),
});

const mcpPlanSchema = z.object({
  contextId: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  steps: z.array(z.unknown()).min(1).optional(),
  headless: z.boolean().optional(),
  captureA11yAfterEachStep: z.boolean().optional(),
  captureScreenshotAfterEachStep: z.boolean().optional(),
  recordVideoOnFailure: z.boolean().optional(),
  artifactsDir: z.string().min(1).optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
  codeHints: codeHintsSchema.optional(),
});

function normalizeRunBody(body: Record<string, unknown>): Record<string, unknown> {
  const planRaw = body.plan;
  if (!planRaw || typeof planRaw !== "object") return body;
  const parsedPlan = mcpPlanSchema.safeParse(planRaw);
  if (!parsedPlan.success) return body;
  const plan = parsedPlan.data;
  return {
    ...body,
    ...(body.contextId === undefined && plan.contextId ? { contextId: plan.contextId } : {}),
    ...(body.baseUrl === undefined && plan.baseUrl ? { baseUrl: plan.baseUrl } : {}),
    ...(body.steps === undefined && plan.steps ? { steps: plan.steps } : {}),
    ...(body.headless === undefined && plan.headless !== undefined ? { headless: plan.headless } : {}),
    ...(body.captureA11yAfterEachStep === undefined && plan.captureA11yAfterEachStep !== undefined
      ? { captureA11yAfterEachStep: plan.captureA11yAfterEachStep }
      : {}),
    ...(body.captureScreenshotAfterEachStep === undefined && plan.captureScreenshotAfterEachStep !== undefined
      ? { captureScreenshotAfterEachStep: plan.captureScreenshotAfterEachStep }
      : {}),
    ...(body.recordVideoOnFailure === undefined && plan.recordVideoOnFailure !== undefined
      ? { recordVideoOnFailure: plan.recordVideoOnFailure }
      : {}),
    ...(body.artifactsDir === undefined && plan.artifactsDir ? { artifactsDir: plan.artifactsDir } : {}),
    ...(body.defaultTimeoutMs === undefined && plan.defaultTimeoutMs !== undefined
      ? { defaultTimeoutMs: plan.defaultTimeoutMs }
      : {}),
    ...(body.codeHints === undefined && plan.codeHints ? { codeHints: plan.codeHints } : {}),
  };
}

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

function parseMemoryStepsFromEvents(events: AssistEvent[]): Step[] {
  const out: Step[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "step_success") continue;
    const payload = event.payload as Record<string, unknown>;
    const raw = payload.step;
    if (!raw || typeof raw !== "object") continue;
    const step = raw as Record<string, unknown>;
    if (typeof step.action !== "string") continue;
    let normalized: Step | null = null;
    if (step.action === "goto" && typeof step.url === "string") {
      normalized = { action: "goto", url: step.url };
    } else if (step.action === "click" && typeof step.selector === "string") {
      normalized = { action: "click", selector: step.selector };
    } else if (
      step.action === "fill" &&
      typeof step.selector === "string" &&
      typeof step.value === "string"
    ) {
      normalized = { action: "fill", selector: step.selector, value: step.value };
    } else if (step.action === "press" && typeof step.key === "string") {
      normalized = { action: "press", key: step.key };
    } else if (step.action === "waitForSelector" && typeof step.selector === "string") {
      normalized = typeof step.timeoutMs === "number"
        ? { action: "waitForSelector", selector: step.selector, timeoutMs: step.timeoutMs }
        : { action: "waitForSelector", selector: step.selector };
    } else if (step.action === "snapshot") {
      normalized = { action: "snapshot" };
    }
    if (!normalized) continue;
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
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

runRouter.post("/runs/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const record = await getRun(id, user.id);
  if (!record) return c.json({ ok: false, error: "not found" }, 404);
  if (record.status !== "running") {
    return c.json({ ok: false, error: "run ya finalizó" }, 409);
  }
  const res = runControlRegistry.cancel(id, user.id);
  if (!res.ok) {
    if (res.reason === "forbidden") return c.json({ ok: false, error: "forbidden" }, 403);
    // Fallback para runs huérfanos tras reinicio del server:
    // el registro quedó en "running" pero no hay AbortController en memoria.
    const nowIso = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - new Date(record.startedAt).getTime());
    const existingSteps: StepOutcome[] = record.steps.map((s) => ({
      index: s.index,
      action: s.action,
      ok: s.ok,
      ...(s.error ? { error: s.error } : {}),
      ...(s.screenshotPath ? { screenshotPath: s.screenshotPath } : {}),
      ...(s.a11y ? { a11y: s.a11y } : {}),
    }));
    await finalizeRun({
      id,
      status: "fail",
      durationMs,
      steps: existingSteps,
      ...(record.videoPath ? { videoPath: record.videoPath } : {}),
    }).catch(() => undefined);
    const lastSeq = record.events?.[record.events.length - 1]?.seq ?? 0;
    const cancelEvent: AssistEvent = {
      seq: lastSeq + 1,
      type: "run_end",
      at: nowIso,
      payload: { cancelled: true, source: "user", staleAfterRestart: true },
    };
    await appendRunEvent(id, cancelEvent).catch(() => undefined);
    runEventBus.publish(id, {
      kind: "assist",
      type: "run_end",
      seq: cancelEvent.seq,
      at: cancelEvent.at,
      payload: cancelEvent.payload,
    });
    runEventBus.publish(id, { kind: "status", status: "fail", at: nowIso });
    runEventBus.close(id);
    return c.json({ ok: true, id, status: "cancelled" as const, stale: true });
  }
  runEventBus.publish(id, {
    kind: "assist",
    type: "run_end",
    seq: Number.MAX_SAFE_INTEGER,
    at: new Date().toISOString(),
    payload: { cancelled: true, source: "user" },
  });
  return c.json({ ok: true, id, status: "cancelling" as const });
});

runRouter.post("/run", async (c) => {
  const user = c.get("user");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "cuerpo JSON inválido" }, 400);
  }
  body = normalizeRunBody(body);

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
  const contextId = typeof body.contextId === "string" ? body.contextId.trim() : "";

  let codeHints: CodeHints | undefined;
  if (body.codeHints !== undefined) {
    const parsedCodeHints = codeHintsSchema.safeParse(body.codeHints);
    if (!parsedCodeHints.success) {
      return c.json({ ok: false, error: "codeHints inválido", details: parsedCodeHints.error.flatten() }, 400);
    }
    codeHints = parsedCodeHints.data;
  }

  let assisted: AssistedMeta | undefined;
  if (body.assisted !== undefined) {
    const parsedAssisted = assistedMetaSchema.safeParse(body.assisted);
    if (!parsedAssisted.success) {
      return c.json({ ok: false, error: "assisted inválido", details: parsedAssisted.error.flatten() }, 400);
    }
    assisted = redactAssistedMeta(parsedAssisted.data);
  }

  let assistV2: z.infer<typeof assistV2Schema> | undefined;
  if (body.assist !== undefined) {
    if (!appConfig.assistV2.enabled) {
      return c.json({ ok: false, error: "assist v2 deshabilitado" }, 409);
    }
    const parsedAssist = assistV2Schema.safeParse(body.assist);
    if (!parsedAssist.success) {
      return c.json({ ok: false, error: "assist inválido", details: parsedAssist.error.flatten() }, 400);
    }
    assistV2 = parsedAssist.data;
    if (assisted) {
      assisted = {
        ...assisted,
        assistConfig: {
          ...(assistV2.victory ? { victory: assistV2.victory } : {}),
          ...(assistV2.maxHorizons !== undefined ? { maxHorizons: assistV2.maxHorizons } : {}),
          ...(assistV2.stepsPerHorizon !== undefined ? { stepsPerHorizon: assistV2.stepsPerHorizon } : {}),
          ...(assistV2.maxLoopMs !== undefined ? { maxLoopMs: assistV2.maxLoopMs } : {}),
          ...(assistV2.isFullPlan !== undefined ? { isFullPlan: assistV2.isFullPlan } : {}),
          ...(assistV2.modalLoaderMaxWaitMs !== undefined
            ? { modalLoaderMaxWaitMs: assistV2.modalLoaderMaxWaitMs }
            : {}),
          ...(assistV2.memoryMode ? { memoryMode: assistV2.memoryMode } : {}),
        },
      };
    }
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
    if (assistV2) {
      // eslint-disable-next-line no-console
      console.log("[assist-run] Config assist v2", {
        isFullPlan: assistV2.isFullPlan ?? false,
        victory: assistV2.victory ?? null,
        maxHorizons: assistV2.maxHorizons ?? appConfig.assistV2.maxHorizons,
        stepsPerHorizon: assistV2.stepsPerHorizon ?? appConfig.assistV2.stepsPerHorizon,
      });
    }
  }

  // Pre-crea el registro en estado "running" para que GET /v1/runs/:id y el SSE
  // puedan empezar a responder inmediatamente mientras la corrida ejecuta.
  try {
    await createRunningRun({
      id,
      userId: user.id,
      startedAt,
      baseUrl: parsed.data.baseUrl,
      project: project || null,
      ...(contextId ? { contextId } : {}),
      assisted,
      codeHints,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: "no se pudo crear run", message }, 500);
  }

  // Notifica estado inicial por el bus para clientes ya suscritos.
  runEventBus.publish(id, { kind: "status", status: "running", at: startedAt });
  const controller = runControlRegistry.register(id, user.id);

  // Fire-and-forget: ejecuta en background, emite eventos al bus y persiste final.
  const executeRun = async () => {
    try {
      let seq = 0;
      const publishAssistEvent = (params: {
        type: AssistEvent["type"];
        payload: Record<string, unknown>;
        stepIndex?: number;
      }) => {
        const event: AssistEvent = {
          seq: ++seq,
          type: params.type,
          at: new Date().toISOString(),
          ...(params.stepIndex !== undefined ? { stepIndex: params.stepIndex } : {}),
          payload: params.payload,
        };
        runEventBus.publish(id, {
          kind: "assist",
          type: event.type,
          seq: event.seq,
          at: event.at,
          ...(event.stepIndex !== undefined ? { stepIndex: event.stepIndex } : {}),
          payload: event.payload,
        });
        void appendRunEvent(id, event);
      };

      let result;
      let memoryCandidateSteps: Step[] = [];
      if (assistV2) {
        const strategist = createStrategist({
          llmTimeoutMs: appConfig.assist.llmTimeoutMs,
          chunkSize: appConfig.assistV2.chunkSize,
        });
        const healer = createHealer({
          llmTimeoutMs: appConfig.assist.llmTimeoutMs,
          chunkSize: appConfig.assistV2.chunkSize,
          codeHints,
        });
        let seedMemorySteps: Step[] = [];
        if ((assistV2.memoryMode ?? appConfig.assistV2.memoryMode) === "adaptive") {
          seedMemorySteps = await getAssistMemory({
            userId: user.id,
            project,
            baseUrl: parsed.data.baseUrl,
            goal: assistV2.goal,
          });
          if (seedMemorySteps.length > 0) {
            // eslint-disable-next-line no-console
            console.log("[assist-run] Memoria durable aplicada", {
              runId: id,
              steps: seedMemorySteps.length,
            });
          }
        }
        const replayFromMemory = seedMemorySteps.length > 0;
        const assistedInput: AssistedRunInput = {
          ...parsed.data,
          steps: parsed.data.steps,
          assist: {
            v2: true,
            goal: assistV2.goal,
            isFullPlan: assistV2.isFullPlan,
            maxHealingAttemptsPerStep:
              assistV2.maxHealingAttemptsPerStep ?? appConfig.assistV2.healingAttempts,
            observerMaxNodes:
              assistV2.observerMaxNodes ?? appConfig.assistV2.observerMaxNodes,
            ...(assistV2.victory ? { victory: assistV2.victory } : {}),
            maxHorizons: assistV2.maxHorizons ?? appConfig.assistV2.maxHorizons,
            stepsPerHorizon: assistV2.stepsPerHorizon ?? appConfig.assistV2.stepsPerHorizon,
            maxLoopMs: assistV2.maxLoopMs ?? appConfig.assistV2.maxLoopMs,
            modalLoaderMaxWaitMs:
              assistV2.modalLoaderMaxWaitMs ?? appConfig.assistV2.modalLoaderMaxWaitMs,
            memoryMode: assistV2.memoryMode ?? appConfig.assistV2.memoryMode,
            ...(seedMemorySteps.length > 0 ? { seedMemorySteps } : {}),
            replayFromMemory,
          },
        };
        const assistedResult = await runAssistedFlow(assistedInput, {
          strategist,
          healer,
          log: (message: string, details?: Record<string, unknown>) => {
            // eslint-disable-next-line no-console
            console.log(`[assist-run v2] ${message}`, details ?? {});
            // Los logs del pipeline vienen como "assist/<type>", los publicamos al bus.
            const type = message.startsWith("assist/") ? message.slice("assist/".length) : message;
            const { stepIndex, ...payload } = (details ?? {}) as Record<string, unknown>;
            const normalizedStepIndex =
              typeof stepIndex === "number" ? stepIndex : undefined;
            publishAssistEvent({
              type: type as AssistEvent["type"],
              payload,
              ...(normalizedStepIndex !== undefined ? { stepIndex: normalizedStepIndex } : {}),
            });
          },
        }, { signal: controller.signal });
        result = assistedResult;
        memoryCandidateSteps = assistedResult.learnedFlow && assistedResult.learnedFlow.length > 0
          ? assistedResult.learnedFlow
          : parseMemoryStepsFromEvents(assistedResult.events);
      } else {
        result = await runFlow(parsed.data, {
          signal: controller.signal,
          onStepStart: ({ index, step }) => {
            publishAssistEvent({
              type: "step_start",
              stepIndex: index,
              payload: { step: summarizeStepForLog(step), rawStep: step as unknown as Record<string, unknown> },
            });
          },
          onStepSuccess: ({ index, step, screenshotPath, a11y }) => {
            publishAssistEvent({
              type: "step_success",
              stepIndex: index,
              payload: {
                step: summarizeStepForLog(step),
                rawStep: step as unknown as Record<string, unknown>,
                ...(screenshotPath ? { screenshotPath } : {}),
                ...(a11y !== undefined ? { a11y } : {}),
              },
            });
          },
          onStepFailure: ({ index, step, error, screenshotPath, final }) => {
            publishAssistEvent({
              type: "step_failure",
              stepIndex: index,
              payload: {
                step: summarizeStepForLog(step),
                rawStep: step as unknown as Record<string, unknown>,
                error,
                ...(screenshotPath ? { screenshotPath } : {}),
                ...(final ? { final: true } : {}),
              },
            });
          },
        });
      }

      const status: "pass" | "fail" = result.ok ? "pass" : "fail";
      await finalizeRun({
        id,
        status,
        durationMs: result.durationMs,
        steps: result.steps,
        ...(result.videoPath !== undefined ? { videoPath: result.videoPath } : {}),
      });

      if (assistV2 && memoryCandidateSteps.length > 0) {
        const memMode = assistV2.memoryMode ?? appConfig.assistV2.memoryMode;
        if (memMode !== "off") {
          const shouldPersist = status === "pass";
          if (shouldPersist) {
            await upsertAssistMemory({
              userId: user.id,
              project,
              baseUrl: parsed.data.baseUrl,
              goal: assistV2.goal,
              steps: memoryCandidateSteps,
            }).catch(() => undefined);
          }
        }
      }

      runEventBus.publish(id, {
        kind: "status",
        status,
        at: new Date().toISOString(),
      });

      if (assisted) {
        // eslint-disable-next-line no-console
        console.log("[assist-run] Ejecución asistida finalizada", {
          runId: id,
          status,
          durationMs: result.durationMs,
          totalSteps: result.steps.length,
          failedSteps: result.steps.filter((step) => !step.ok).length,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error("[assist-run] Error en ejecución asistida", { runId: id, message });
      try {
        await finalizeRun({
          id,
          status: "fail",
          durationMs: Date.now() - new Date(startedAt).getTime(),
          steps: [],
        });
      } catch {
        // ignore
      }
      runEventBus.publish(id, {
        kind: "status",
        status: "fail",
        at: new Date().toISOString(),
      });
    } finally {
      runControlRegistry.complete(id);
      runEventBus.close(id);
    }
  };

  // No await: lanza y responde ya.
  void executeRun();

  return c.json({ ok: true, id, status: "running" as const }, 202);
});
