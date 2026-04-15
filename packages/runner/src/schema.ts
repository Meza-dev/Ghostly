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
]);

export const runInputSchema = z.object({
  baseUrl: z.string().url(),
  steps: z.array(stepSchema).min(1),
  headless: z.boolean().optional().default(true),
  captureA11yAfterEachStep: z.boolean().optional().default(false),
  defaultTimeoutMs: z.number().int().positive().optional().default(30_000),
});

export type Step = z.infer<typeof stepSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
