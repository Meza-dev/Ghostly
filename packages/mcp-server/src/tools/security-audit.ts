import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const tool = "ghostly_audit_security";
const limits = { entries: 1_000, files: 200, bytes: 2 * 1024 * 1024, fileBytes: 128 * 1024, depth: 16, findings: 50 };
const excluded = new Set([
  "node_modules", "vendor", "dist", "build", "coverage", "out", "target",
  "credentials.json", "secrets.json", "service-account.json",
]);
const locks = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies"];
const scannedExtension = /\.(?:[cm]?[jt]sx?|json|ya?ml)$/i;
const dockerfile = /^dockerfile(?:\.[\w-]+)?$/i;
const credential = /(?:^|[\s,{])["']?(?:api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?token|password)["']?\s*[:=]\s*["']([^"'\r\n]{8,512})["']/gi;
const placeholder = /^(?:change[_ -]?me|replace[_ -]?me|your[_ -].*|example[_ -].*|\$\{.*\}|\{\{.*\}\})$/i;

type Finding = {
  rule: string;
  evidence: { file: string; line: number };
  confidence: "medium" | "high";
  impact: string;
  mitigation: string;
};

function allowedSegment(value: string): boolean {
  return /^[a-z\d_][a-z\d_. -]{0,127}$/i.test(value) &&
    !/[. ]$/.test(value) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) &&
    !excluded.has(value.toLowerCase());
}

function matchesFile(name: string): boolean {
  return !locks.includes(name.toLowerCase()) && (dockerfile.test(name) || scannedExtension.test(name));
}

async function containedEntry(root: string, relative: string): Promise<Stats | undefined> {
  const absolute = path.join(root, relative);
  try {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink() || path.relative(absolute, await realpath(absolute)) !== "") return;
    return stat;
  } catch {
    return;
  }
}

async function validateScope(root: string, scope: string): Promise<boolean> {
  if (scope === ".") return true;
  const segments = scope.split("/");
  if (segments.length > limits.depth || !segments.every(allowedSegment)) return false;
  for (let index = 1; index <= segments.length; index++) {
    const info = await containedEntry(root, segments.slice(0, index).join("/"));
    if (info?.isDirectory()) continue;
    if (index !== segments.length || !info?.isFile() || !matchesFile(path.posix.basename(scope))) return false;
  }
  return true;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.isFile() && right.isFile() && left.nlink === 1 && right.nlink === 1 &&
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readBounded(root: string, file: string, info: Stats): Promise<string | undefined> {
  const absolute = path.join(root, file);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  try {
    const handle = await open(absolute, flags);
    try {
      const before = await handle.stat();
      const named = await containedEntry(root, file);
      if (!named || !sameFile(before, info) || !sameFile(before, named)) return;
      const buffer = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) return;
        offset += bytesRead;
      }
      if (!sameFile(before, await handle.stat()) || buffer.includes(0)) return;
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
}

async function hasLockfile(root: string, manifest: string): Promise<boolean> {
  let directory = path.posix.dirname(manifest);
  for (;;) {
    for (const lock of locks) {
      const info = await containedEntry(root, path.posix.join(directory, lock));
      if (info?.isFile() && info.nlink === 1) return true;
    }
    if (directory === ".") return false;
    directory = path.posix.dirname(directory);
  }
}

function scanLines(file: string, lines: string[], add: (finding: Finding) => void): void {
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:\/\/|#|\/\*|\*)/.test(line)) continue;
    const evidence = { file, line: index + 1 };
    if ([...line.matchAll(credential)].some((match) => {
      const value = match[1]?.trim();
      return value && !placeholder.test(value);
    })) {
      add({
        rule: "possible-embedded-credential", evidence, confidence: "medium",
        impact: "A real credential committed in source could be exposed to repository readers.",
        mitigation: "Confirm the value is synthetic. If it is real, revoke or rotate it and supply the replacement at runtime.",
      });
    }
    if (dockerfile.test(path.posix.basename(file)) && /^\s*USER\s+(?:root|0)(?:\s|:|$)/i.test(line)) {
      add({
        rule: "explicit-root-container-user", evidence, confidence: "high",
        impact: "A stage running as root has broader permissions inside the container.",
        mitigation: "Verify the final runtime stage uses a dedicated non-root user where possible.",
      });
    }
    if (/^\s*(?:ENV\s+|-\s*)?["']?NODE_TLS_REJECT_UNAUTHORIZED["']?\s*[:= ]\s*["']?0["']?\s*[,#]?\s*$/.test(line)) {
      add({
        rule: "tls-verification-disabled", evidence, confidence: "high",
        impact: "If this setting is applied, Node can accept certificates it would otherwise reject.",
        mitigation: "Enable certificate verification and configure the intended certificate authority for the environment.",
      });
    }
  }
}

function readDeclarations(text: string): Array<{ name: string; range: string }> | undefined {
  try {
    const manifest: unknown = JSON.parse(text);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return;
    const fields = manifest as Record<string, unknown>;
    return dependencyFields.flatMap((field) => {
      const dependencies = fields[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return [];
      return Object.entries(dependencies)
        .flatMap(([name, range]) => typeof range === "string" ? [{ name, range }] : []);
    });
  } catch {
    return;
  }
}

async function audit(root: string, scope: string) {
  const findings: Finding[] = [];
  const gaps = new Set<string>();
  const coverage = { entries: 0, files: 0, bytes: 0, skippedFiles: 0, excludedEntries: 0,
    dependencyManifests: { inspected: 0, withLockfile: 0 } };
  const add = (finding: Finding) => {
    if (findings.length < limits.findings) findings.push(finding);
    else gaps.add("finding-limit");
  };

  async function visit(file: string, depth: number): Promise<void> {
    const info = await containedEntry(root, file);
    if (!info) {
      gaps.add("unreadable-or-unstable-entry");
      return;
    }
    if (info.isDirectory()) {
      if (depth >= limits.depth) {
        gaps.add("depth-limit");
        return;
      }
      try {
        const entries = [];
        for await (const entry of await opendir(path.join(root, file))) {
          if (coverage.entries >= limits.entries) {
            gaps.add("entry-limit");
            break;
          }
          coverage.entries++;
          if (allowedSegment(entry.name) && !entry.isSymbolicLink()) entries.push(entry.name);
          else coverage.excludedEntries++;
        }
        for (const name of entries.sort()) await visit(path.posix.join(file, name), depth + 1);
      } catch {
        gaps.add("unreadable-directory");
      }
      return;
    }
    if (!info.isFile() || !matchesFile(path.posix.basename(file))) return;
    if (info.size > limits.fileBytes || coverage.files >= limits.files || coverage.bytes + info.size > limits.bytes) {
      coverage.skippedFiles++;
      gaps.add("file-or-byte-limit");
      return;
    }
    const text = await readBounded(root, file, info);
    if (text === undefined) {
      coverage.skippedFiles++;
      gaps.add("unreadable-or-unstable-file");
      return;
    }
    coverage.files++;
    coverage.bytes += info.size;
    const lines = text.split(/\r?\n/);
    scanLines(file, lines, add);
    if (path.posix.basename(file) !== "package.json") return;
    const dependencies = readDeclarations(text);
    if (!dependencies) {
      gaps.add("invalid-dependency-manifest");
      return;
    }
    if (!dependencies.length) return;
    coverage.dependencyManifests.inspected++;
    const declarationsLine = Math.max(1, lines.findIndex((line) => /"(?:devDependencies|optionalDependencies|dependencies)"\s*:/.test(line)) + 1);
    if (await hasLockfile(root, file)) coverage.dependencyManifests.withLockfile++;
    else add({
      rule: "dependency-lockfile-not-observed", evidence: { file, line: declarationsLine }, confidence: "medium",
      impact: "Unrecorded resolutions can make dependency installs vary between environments.",
      mitigation: "Use the project's package manager to create and track the intended lockfile.",
    });
    for (const { name, range } of dependencies) {
      if (!["*", "latest", "next"].includes(range)) continue;
      const line = lines.findIndex((value) => value.includes(JSON.stringify(name)) && value.includes(JSON.stringify(range))) + 1;
      add({
        rule: "floating-dependency", evidence: { file, line: line || declarationsLine }, confidence: "high",
        impact: "This declaration permits dependency selection to change as versions or tags move.",
        mitigation: "Choose an intentional range and use a frozen or locked install in CI.",
      });
    }
  }

  await visit(scope, 0);
  findings.sort((a, b) => a.evidence.file.localeCompare(b.evidence.file, "en") || a.evidence.line - b.evidence.line);
  return { tool, status: gaps.size ? "partial" : "complete", coverage, gaps: [...gaps].sort(), limits, findings };
}

export function registerSecurityAuditTool(server: McpServer): void {
  server.tool(
    tool,
    "Read-only local security hygiene review. Reports repository-relative evidence, impact and mitigation without values or source excerpts.",
    { scope: z.string().max(256).optional().describe("Repository-relative directory or file. Omit to inspect the workspace.") },
    { readOnlyHint: true, openWorldHint: false },
    async ({ scope = "." }): Promise<CallToolResult> => {
      try {
        const root = await realpath(process.env.GHOST_TARGET_PROJECT_ROOT ?? process.cwd());
        const report = await validateScope(root, scope)
          ? await audit(root, scope)
          : { tool, status: "unsupported", reason: "Use an existing, in-workspace file or directory permitted by the audit scope rules.", findings: [] };
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch {
        return {
          content: [{ type: "text", text: JSON.stringify({ tool, status: "error", reason: "Could not inspect the workspace." }) }],
          isError: true,
        };
      }
    },
  );
}
