import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export type AppConfig = {
  port: number;
  host: string;
  nodeEnv: string;
  assist: {
    enabled: boolean;
    maxSteps: number;
    maxTimeoutMs: number;
    maxGoalChars: number;
    llmTimeoutMs: number;
  };
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
  const parseIntOr = (raw: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const rawPort = process.env.API_PORT ?? process.env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    port: Number.isFinite(port) ? port : 3000,
    host,
    nodeEnv,
    assist: {
      enabled: (process.env.ASSIST_ENABLED ?? "true").toLowerCase() !== "false",
      maxSteps: parseIntOr(process.env.ASSIST_MAX_STEPS, 25),
      maxTimeoutMs: parseIntOr(process.env.ASSIST_MAX_TIMEOUT_MS, 120_000),
      maxGoalChars: parseIntOr(process.env.ASSIST_MAX_GOAL_CHARS, 2_000),
      llmTimeoutMs: parseIntOr(process.env.ASSIST_LLM_TIMEOUT_MS, 45_000),
    },
  };
}
