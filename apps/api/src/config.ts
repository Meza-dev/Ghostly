import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export type AppConfig = {
  port: number;
  host: string;
  nodeEnv: string;
};

function hydrateEnv(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(moduleDir, "../../.env"),
    resolve(moduleDir, "../../../.env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      break;
    }
  }
}

export function loadConfig(): AppConfig {
  hydrateEnv();
  const rawPort = process.env.API_PORT ?? process.env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    port: Number.isFinite(port) ? port : 3000,
    host,
    nodeEnv,
  };
}
