import { runFlow, type Step } from "../packages/runner/src/index.js";

async function main() {
  const username = process.env.TMS_USER ?? "admin";
  const password = process.env.TMS_PASSWORD ?? "admin";

  const steps: Step[] = [
    { action: "goto", url: "/backoffice" },
    // Ajustados a un login genérico con dos inputs + botón "Ingresar"
    { action: "waitForSelector", selector: 'input[type="text"]' },
    { action: "fill", selector: 'input[type="text"]', value: username },
    { action: "fill", selector: 'input[type="password"]', value: password },
    { action: "click", selector: 'button:has-text("Ingresar")' },
    // TODO: ajustar a un selector concreto de la app logueada
    { action: "waitForSelector", selector: "text=Ingresar" },
  ];

  const result = await runFlow({
    baseUrl: "http://tms.localhost",
    steps,
    headless: false,
    captureScreenshotAfterEachStep: true,
    recordVideoOnFailure: true,
    artifactsDir: "artifacts/tms-login",
    defaultTimeoutMs: 30_000,
  });

  // Resultado estructurado con cada paso y paths de evidencias
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

