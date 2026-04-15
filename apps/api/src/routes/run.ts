import { runFlow, runInputSchema } from "@ghosttester/runner";
import { Hono } from "hono";

export const runRouter = new Hono();

runRouter.post("/run", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
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

  try {
    const result = await runFlow(parsed.data);
    return c.json(result, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: "runner", message }, 500);
  }
});
