import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(__dirname, "..");

function run(cmd, { capture = false } = {}) {
  console.log(`\n▶ ${cmd}`);
  if (capture) {
    return execSync(cmd, {
      cwd: cliDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: true,
    });
  }
  execSync(cmd, { cwd: cliDir, stdio: "inherit", shell: true });
  return "";
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\n❌ publish-check falló: ${message}`);
    process.exit(1);
  }
}

function extractSizeMb(stdout) {
  const line = stdout
    .split("\n")
    .find((l) => l.toLowerCase().includes("npm notice package size:"));
  if (!line) return null;
  const match = line.match(/package size:\s*([\d.]+)\s*([kmg]b)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "kb") return value / 1024;
  if (unit === "mb") return value;
  if (unit === "gb") return value * 1024;
  return null;
}

run("pnpm typecheck");
run("pnpm build");

const packOut = run("npm pack --dry-run", { capture: true });
process.stdout.write(packOut);

assert(!/\.tmp\d*|\.tmp/i.test(packOut), "el tarball todavía contiene archivos temporales .tmp");
assert(!/dev\.db/i.test(packOut), "el tarball todavía contiene dev.db");

const sizeMb = extractSizeMb(packOut);
if (sizeMb !== null) {
  // Guardrail pragmático para evitar publicar un tarball inflado por accidente.
  assert(sizeMb <= 25, `el paquete pesa ${sizeMb.toFixed(1)} MB (> 25 MB)`);
}

console.log("\n✅ publish-check OK: build, typecheck y tarball listos para publicar.");
