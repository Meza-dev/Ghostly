import { execFileSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";

export type ComponentInfo = {
  name: string;
  file: string;
  testIds: string[];
  ariaLabels: string[];
  roles: string[];
};

export type FormInputInfo = {
  testId?: string;
  ariaLabel?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  type?: string;
};

export type FormInfo = {
  name: string;
  file: string;
  inputs: FormInputInfo[];
  submitTestId?: string;
  submitLabel?: string;
};

export type RouteInfo = {
  path: string;
  component?: string;
};

export type FlowDocInfo = {
  name: string;
  docFile: string;
};

export type ScanResult = {
  components: ComponentInfo[];
  forms: FormInfo[];
};

export type ManifestOptions = {
  projectRoot: string;
  baseUrl?: string;
  flows?: FlowDocInfo[];
};

export const ghostManifestSchema = z.object({
  version: z.literal("1"),
  generatedAt: z.string().datetime(),
  gitCommit: z.string().min(1),
  projectRoot: z.string().min(1),
  baseUrl: z.string().url().optional(),
  routes: z.array(z.object({
    path: z.string().min(1),
    component: z.string().min(1).optional(),
  })),
  components: z.array(z.object({
    name: z.string().min(1),
    file: z.string().min(1),
    testIds: z.array(z.string()),
    ariaLabels: z.array(z.string()),
    roles: z.array(z.string()),
  })),
  forms: z.array(z.object({
    name: z.string().min(1),
    file: z.string().min(1),
    inputs: z.array(z.object({
      testId: z.string().min(1).optional(),
      ariaLabel: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
    })),
    submitTestId: z.string().min(1).optional(),
    submitLabel: z.string().min(1).optional(),
  })),
  flows: z.array(z.object({
    name: z.string().min(1),
    docFile: z.string().min(1),
  })),
  selectors: z.object({
    byTestId: z.record(z.string(), z.string()),
    byAriaLabel: z.record(z.string(), z.string()),
  }),
});

export type GhostManifest = z.infer<typeof ghostManifestSchema>;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function getGitCommit(projectRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot).replace(/\\/g, "/");
}

export function buildManifest(
  scan: ScanResult,
  routes: RouteInfo[],
  options: ManifestOptions,
): GhostManifest {
  const byTestId: Record<string, string> = {};
  const byAriaLabel: Record<string, string> = {};

  const components = scan.components.map((component) => {
    for (const testId of component.testIds) byTestId[testId] = component.file;
    for (const ariaLabel of component.ariaLabels) byAriaLabel[ariaLabel] = component.file;
    return {
      ...component,
      testIds: uniqueSorted(component.testIds),
      ariaLabels: uniqueSorted(component.ariaLabels),
      roles: uniqueSorted(component.roles),
    };
  });

  const manifest = {
    version: "1" as const,
    generatedAt: new Date().toISOString(),
    gitCommit: getGitCommit(options.projectRoot),
    projectRoot: normalizeProjectRoot(options.projectRoot),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    routes,
    components,
    forms: scan.forms,
    flows: options.flows ?? [],
    selectors: {
      byTestId,
      byAriaLabel,
    },
  };

  return ghostManifestSchema.parse(manifest);
}
