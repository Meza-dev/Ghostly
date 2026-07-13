import { z } from "zod";

export const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().min(1) }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({ action: z.literal("press"), key: z.string().min(1) }),
  z.object({
    action: z.literal("waitForSelector"),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("snapshot") }),
  z.object({
    action: z.literal("selectOption"),
    selector: z.string().min(1),
    // D1: unión string|string[] — espeja page.selectOption() y evita forzar array en el caso común.
    value: z.union([z.string(), z.array(z.string()).min(1)]),
  }),
  z.object({ action: z.literal("check"), selector: z.string().min(1) }),
  z.object({ action: z.literal("uncheck"), selector: z.string().min(1) }),
  z.object({
    action: z.literal("setInputFiles"),
    selector: z.string().min(1),
    // D2: solo nombres relativos, resueltos contra uploadFixturesDir en el executor (zero-trust sandbox).
    files: z.array(z.string().min(1)).min(1),
  }),
  z.object({ action: z.literal("hover"), selector: z.string().min(1) }),
]);

const runInputBaseSchema = z.object({
  baseUrl: z.string().url(),
  steps: z.array(stepSchema).min(1),
  headless: z.boolean().optional().default(true),
  captureA11yAfterEachStep: z.boolean().optional().default(false),
  captureScreenshotAfterEachStep: z.boolean().optional().default(false),
  recordVideoOnFailure: z.boolean().optional().default(false),
  artifactsDir: z.string().min(1).optional().default("artifacts"),
  defaultTimeoutMs: z.number().int().positive().optional().default(30_000),
  // D2: raíz sandbox para setInputFiles; sin configurar, el verbo queda deshabilitado (default-deny).
  uploadFixturesDir: z.string().min(1).optional(),
});

export type RunGuardrails = {
  maxSteps: number;
  maxTimeoutMs: number;
  enforceSameOrigin: boolean;
};

export const DEFAULT_RUN_GUARDRAILS: RunGuardrails = {
  maxSteps: 25,
  maxTimeoutMs: 120_000,
  enforceSameOrigin: true,
};

export function createRunInputSchema(guardrails?: Partial<RunGuardrails>) {
  const limits: RunGuardrails = { ...DEFAULT_RUN_GUARDRAILS, ...guardrails };
  return runInputBaseSchema.superRefine((input, ctx) => {
    if (input.steps.length > limits.maxSteps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: `steps excede el máximo permitido (${limits.maxSteps})`,
      });
    }
    if (input.defaultTimeoutMs > limits.maxTimeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultTimeoutMs"],
        message: `defaultTimeoutMs excede el máximo permitido (${limits.maxTimeoutMs})`,
      });
    }
    if (!limits.enforceSameOrigin) return;

    const baseOrigin = new URL(input.baseUrl).origin;
    for (let index = 0; index < input.steps.length; index++) {
      const step = input.steps[index]!;
      if (step.action !== "goto") continue;
      const targetOrigin = new URL(step.url, input.baseUrl).origin;
      if (targetOrigin !== baseOrigin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "url"],
          message: "goto.url debe compartir el mismo origin que baseUrl",
        });
      }
    }
  });
}

export const runInputSchema = createRunInputSchema();
export function safeParseRunInput(
  input: unknown,
  guardrails?: Partial<RunGuardrails>,
) {
  return createRunInputSchema(guardrails).safeParse(input);
}

export type Step = z.infer<typeof stepSchema>;
export type RunInput = z.infer<typeof runInputSchema>;

export type RunStatus = "pass" | "fail" | "running";

export type AssistedMeta = {
  goal: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  assistConfig?: {
    victory?: {
      textIncludes?: string[];
      selectorVisible?: string[];
      urlIncludes?: string[];
      mustAll?: boolean;
    };
    isFullPlan?: boolean;
    maxHorizons?: number;
    stepsPerHorizon?: number;
    maxLoopMs?: number;
    modalLoaderMaxWaitMs?: number;
    memoryMode?: "off" | "runtime" | "adaptive";
  };
};

export type RunRecord = {
  id: string;
  status: RunStatus;
  /** Taxonomía de veredictos (spec §5). `undefined` en runs históricos ("sin clasificar"). */
  verdict?: string;
  /** Razonamiento del juez o descripción del check determinista que resolvió el veredicto. */
  verdictReason?: string;
  /** `stopReason` interno del pipeline (spec §6) — por qué terminó el loop. */
  stopReason?: string;
  startedAt: string;
  durationMs: number;
  baseUrl: string;
  project?: string;
  contextId?: string;
  assisted?: AssistedMeta;
  steps: import("./run.js").StepOutcome[];
  videoPath?: string;
};
