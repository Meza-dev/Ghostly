import { Command } from "commander";
import { registerConfig } from "./commands/config.js";
import { registerInstall } from "./commands/install.js";
import { registerKeygen } from "./commands/keygen.js";
import { registerUp } from "./commands/up.js";
import { registerUpdate } from "./commands/update.js";

const program = new Command();

program
  .name("ghostly")
  .description("Ghostly CLI — zero-config E2E testing")
  .version("0.1.0");

registerInstall(program);
registerKeygen(program);
registerConfig(program);
registerUp(program);
registerUpdate(program);

program.parse(process.argv);
