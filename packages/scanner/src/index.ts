import path from "node:path";
import { generateManifest } from "./scan.js";

type CliOptions = {
  root: string;
  out?: string;
  baseUrl?: string;
  flowDocsDir?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    root: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--root" && next) {
      opts.root = next;
      i++;
    } else if (arg === "--out" && next) {
      opts.out = next;
      i++;
    } else if (arg === "--base-url" && next) {
      opts.baseUrl = next;
      i++;
    } else if (arg === "--flow-docs-dir" && next) {
      opts.flowDocsDir = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return opts;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log([
    "ghost-scan",
    "",
    "Genera ghost-manifest.json desde el AST del proyecto.",
    "",
    "Opciones:",
    "  --root <dir>            Proyecto a analizar (default: cwd)",
    "  --out <file>            Archivo destino (default: ghost-manifest.json)",
    "  --base-url <url>        Base URL sugerida para runs",
    "  --flow-docs-dir <dir>   Carpeta de *.ghost.md (default: docs/flows)",
  ].join("\n"));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(opts.root);
  const { outPath } = await generateManifest({
    projectRoot,
    ...(opts.out ? { outPath: opts.out } : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.flowDocsDir ? { flowDocsDir: opts.flowDocsDir } : {}),
  });
  // eslint-disable-next-line no-console
  console.log(`ghost-manifest.json generado en ${outPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`ghost-scan falló: ${message}`);
  process.exit(1);
});
