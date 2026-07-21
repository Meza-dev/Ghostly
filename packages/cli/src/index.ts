import { Command } from "commander";
import { registerConfig } from "./commands/config.js";
import { registerInstall } from "./commands/install.js";
import { registerKeygen } from "./commands/keygen.js";
import { registerMcp } from "./commands/mcp.js";
import { registerUp } from "./commands/up.js";
import { registerUpdate } from "./commands/update.js";
import { getCliVersion } from "./lib/paths.js";

const program = new Command();

program
  .name("ghostly")
  .description("Ghostly CLI — zero-config E2E testing")
  // Lee la versión del package.json (fuente única) — evita el drift del número hardcodeado.
  .version(getCliVersion());

registerInstall(program);
registerKeygen(program);
registerConfig(program);
registerMcp(program);
registerUp(program);
registerUpdate(program);

program.parse(process.argv);
