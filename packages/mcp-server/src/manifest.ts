import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// Ruta al CLI del scanner dentro del monorepo Ghostly.
// import.meta.url → .../packages/mcp-server/dist/index.js
// scanner CLI   → .../packages/scanner/dist/index.js
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCANNER_DIST = path.resolve(__dirname, "../../scanner/dist/index.js");

const GENERATE_TIMEOUT_MS = 90_000;

const manifestSchema = z.object({
  version: z.literal("1"),
  generatedAt: z.string(),
  gitCommit: z.string(),
  projectRoot: z.string(),
  baseUrl: z.string().optional(),
  routes: z.array(z.object({
    path: z.string(),
    component: z.string().optional(),
  })).default([]),
  components: z.array(z.object({
    name: z.string(),
    file: z.string(),
    testIds: z.array(z.string()).default([]),
    ariaLabels: z.array(z.string()).default([]),
    roles: z.array(z.string()).default([]),
  })).default([]),
  forms: z.array(z.object({
    name: z.string(),
    file: z.string(),
    inputs: z.array(z.object({
      testId: z.string().optional(),
      ariaLabel: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      placeholder: z.string().optional(),
      type: z.string().optional(),
    })).default([]),
    submitTestId: z.string().optional(),
    submitLabel: z.string().optional(),
  })).default([]),
  flows: z.array(z.object({
    name: z.string(),
    docFile: z.string(),
  })).default([]),
  selectors: z.object({
    byTestId: z.record(z.string()).default({}),
    byAriaLabel: z.record(z.string()).default({}),
  }).default({ byTestId: {}, byAriaLabel: {} }),
});

export type GhostManifest = z.infer<typeof manifestSchema>;

export type LoadedManifest = {
  manifest: GhostManifest;
  manifestPath: string;
  warning?: string;
};

function resolveManifestPath(manifestPath?: string, projectRoot?: string): string {
  if (manifestPath) return path.resolve(manifestPath);
  if (process.env.GHOST_MANIFEST_PATH) return path.resolve(process.env.GHOST_MANIFEST_PATH);
  // Preferir projectRoot explícito > env var > cwd
  const root = projectRoot
    ? path.resolve(projectRoot)
    : process.env.GHOST_TARGET_PROJECT_ROOT
      ? path.resolve(process.env.GHOST_TARGET_PROJECT_ROOT)
      : process.cwd();
  return path.join(root, ".ghostly", "ghost-manifest.json");
}

function currentGitCommit(projectRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export async function loadManifest(manifestPath?: string, projectRoot?: string): Promise<LoadedManifest> {
  const resolved = resolveManifestPath(manifestPath, projectRoot);
  const raw = await fs.readFile(resolved, "utf8");
  const manifest = manifestSchema.parse(JSON.parse(raw) as unknown);
  const currentCommit = currentGitCommit(manifest.projectRoot);
  const warning = currentCommit && manifest.gitCommit !== "unknown" && manifest.gitCommit !== currentCommit
    ? `The manifest was generated at commit ${manifest.gitCommit}, but the current HEAD is ${currentCommit}. Run ghost-scan to refresh it.`
    : undefined;

  return {
    manifest,
    manifestPath: resolved,
    ...(warning ? { warning } : {}),
  };
}

async function runScan(projectRoot: string, outPath: string): Promise<void> {
  try {
    await execFileAsync(
      process.execPath,
      [SCANNER_DIST, "--root", projectRoot, "--out", outPath],
      { timeout: GENERATE_TIMEOUT_MS },
    );
  } catch (err: unknown) {
    // execFile incluye stdout/stderr en el error — propagar con detalle
    if (err && typeof err === "object" && "stderr" in err) {
      const detail = (err as { stderr?: string; stdout?: string });
      const msg = [
        `ghost-scan failed for: ${projectRoot}`,
        detail.stderr?.trim() || detail.stdout?.trim() || String(err),
      ].filter(Boolean).join("\n");
      throw new Error(msg);
    }
    throw err;
  }
}

export async function ensureManifest(options?: {
  manifestPath?: string;
  projectRoot?: string;
}): Promise<LoadedManifest & { generated: boolean }> {
  const targetProjectRoot = options?.projectRoot
    ? path.resolve(options.projectRoot)
    : process.env.GHOST_TARGET_PROJECT_ROOT
      ? path.resolve(process.env.GHOST_TARGET_PROJECT_ROOT)
      : process.cwd();

  // El manifest vive siempre dentro del projectRoot a menos que se indique explícitamente.
  const targetManifestPath = resolveManifestPath(options?.manifestPath, targetProjectRoot);

  const tryLoad = async (): Promise<LoadedManifest | undefined> => {
    try { return await loadManifest(targetManifestPath, targetProjectRoot); } catch { return undefined; }
  };

  const loaded = await tryLoad();
  const isStale = !!loaded?.warning;
  if (loaded && !isStale) {
    return { ...loaded, generated: false };
  }

  // Si no existe o está desactualizado, generar en proceso hijo (no bloquea el servidor MCP).
  await runScan(targetProjectRoot, targetManifestPath);
  const fresh = await loadManifest(targetManifestPath, targetProjectRoot);
  return { ...fresh, generated: true };
}

export function stableCodeHints(manifest: GhostManifest): Record<string, unknown> {
  return {
    components: manifest.components.map((component) => ({
      name: component.name,
      file: component.file,
      testIds: component.testIds,
      ariaLabels: component.ariaLabels,
      roles: component.roles,
    })),
    forms: manifest.forms,
    routes: manifest.routes,
    selectors: manifest.selectors,
  };
}
