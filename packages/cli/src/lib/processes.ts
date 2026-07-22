import { execSync, spawnSync } from "node:child_process";

/**
 * Mata procesos node residuales que corren desde el paquete global @ghostly-io
 * (MCP servers de editores, servers viejos). En Windows esos procesos lockean
 * node_modules/@ghostly-io/cli y npm no puede renombrar el paquete al
 * actualizar (EBUSY). Best effort: los editores relanzan sus MCP servers solos.
 * Solo win32 — en unix el rename de npm no choca con archivos abiertos.
 */
export function killStrayGhostlyProcesses(): void {
  if (process.platform !== "win32") return;
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*@ghostly-io*' } | " +
    "Select-Object -ExpandProperty ProcessId";
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0 || !result.stdout) return;
  for (const line of result.stdout.split(/\r?\n/)) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Ya muerto o sin permisos — seguimos.
    }
  }
}
