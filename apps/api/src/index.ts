import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { getJwtSecret } from "./lib/token.js";

// loadConfig() hidrata el .env; recién después el secreto está disponible.
const config = loadConfig();

// Guard de arranque (C2): el servidor NO debe levantar sin un JWT_SECRET fuerte.
// Sin esto, un secreto por defecto/ausente permite forjar tokens de admin.
try {
  getJwtSecret();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

// Watchdog anti-huérfanos: si el CLI padre desaparece (terminal cerrada, kill
// duro), el server no debe quedar vivo. `process.kill(pid, 0)` solo comprueba
// existencia — lanza si el proceso ya no está.
const parentPid = Number(process.env.GHOST_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 5_000).unref();
}

const app = createApp();

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    const address = `http://${info.address}:${info.port}`;
    process.stdout.write(`listening ${address}\n`);
  },
);
