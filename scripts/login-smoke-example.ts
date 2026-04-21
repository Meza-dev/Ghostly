/**
 * Ejemplo mínimo de runFlow: configura GHOST_BASE_URL y, si quieres, GHOST_STEPS_JSON
 * con un array JSON de pasos (mismo formato que el runner). Sin URLs ni textos de una app concreta.
 */
import { runFlow, type Step } from "../packages/runner/src/index.js";

async function main() {
  const baseUrl = process.env.GHOST_BASE_URL?.trim() || "http://127.0.0.1:3000";
  const rawSteps = process.env.GHOST_STEPS_JSON?.trim();
  const steps: Step[] = rawSteps
    ? (JSON.parse(rawSteps) as Step[])
    : [{ action: "goto", url: "/" }];

  const result = await runFlow({
    baseUrl,
    steps,
    headless: process.env.GHOST_HEADLESS !== "0",
    captureScreenshotAfterEachStep: true,
    recordVideoOnFailure: true,
    artifactsDir: process.env.GHOST_ARTIFACTS_DIR?.trim() || "artifacts/login-smoke",
    defaultTimeoutMs: Number(process.env.GHOST_TIMEOUT_MS) || 30_000,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
