import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import { walkAst } from "./ast-walker.js";
import { buildManifest, type FlowDocInfo, type GhostManifest } from "./manifest-builder.js";
import { extractRoutes } from "./route-extractor.js";

export type ScanOptions = {
  projectRoot: string;
  outPath?: string;
  baseUrl?: string;
  flowDocsDir?: string;
};

const configSchema = z.object({
  baseUrl: z.string().url().optional(),
  flowDocsDir: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
});

type GhosttesterConfig = z.infer<typeof configSchema>;

async function readConfig(projectRoot: string): Promise<GhosttesterConfig> {
  const configPath = path.join(projectRoot, "ghosttester.config.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return configSchema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function discoverFlowDocs(projectRoot: string, flowDocsDir: string): Promise<FlowDocInfo[]> {
  const docsRoot = path.resolve(projectRoot, flowDocsDir);
  const matches = await glob("**/*.ghost.md", {
    cwd: docsRoot,
    nodir: true,
    windowsPathsNoEscape: true,
  }).catch(() => []);

  return matches.sort().map((match) => {
    const docFile = path.relative(projectRoot, path.join(docsRoot, match)).replace(/\\/g, "/");
    return {
      name: path.basename(match, ".ghost.md"),
      docFile,
    };
  });
}

export async function generateManifest(options: ScanOptions): Promise<{
  manifest: GhostManifest;
  outPath: string;
}> {
  const projectRoot = path.resolve(options.projectRoot);
  const config = await readConfig(projectRoot);
  const baseUrl = options.baseUrl ?? config.baseUrl;
  const flowDocsDir = options.flowDocsDir ?? config.flowDocsDir ?? "docs/flows";
  const outPath = path.resolve(
    projectRoot,
    options.outPath ?? config.manifestPath ?? "ghost-manifest.json",
  );

  const [scan, routes, flows] = await Promise.all([
    walkAst(projectRoot),
    Promise.resolve(extractRoutes(projectRoot)),
    discoverFlowDocs(projectRoot, flowDocsDir),
  ]);

  const manifest = buildManifest(scan, routes, {
    projectRoot,
    ...(baseUrl ? { baseUrl } : {}),
    flows,
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, outPath };
}
