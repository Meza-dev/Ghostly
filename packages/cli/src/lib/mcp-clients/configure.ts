import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { getMcpServerEntryPath } from "../paths.js";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

/**
 * Camino compartido para configurar UN cliente MCP: overwrite-confirm si ya está
 * configurado, inject() + installGuidance() + restart hint en éxito. Usado por
 * `ghostly install` (multi-cliente) y `ghostly mcp add <client>` (single-cliente),
 * así el flujo por-cliente vive en un solo lugar (DRY).
 */
export async function configureClient(client: McpClient, entry: McpEntry): Promise<InjectResult> {
  if (client.isConfigured()) {
    const overwrite = await p.confirm({
      message: `A Ghostly configuration already exists for ${client.label}. Overwrite it?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.log.info(`${client.label} configuration left unchanged.`);
      return { status: "already", detail: "left unchanged by user choice" };
    }
  }

  const spin = p.spinner();
  spin.start(`Injecting MCP server into ${client.label}`);
  try {
    const mcpEntryPath = getMcpServerEntryPath();
    if (!existsSync(mcpEntryPath)) {
      throw new Error(
        `${mcpEntryPath} not found. Reinstall or update @ghostly-io/cli to include the bundled MCP server.`,
      );
    }

    const result = client.inject(entry);
    if (result.status === "skipped-backup") {
      spin.stop(`${client.label} MCP config left unchanged`);
      p.log.warn(
        `Your ${client.label} config could not be read, so Ghostly did NOT modify it (${result.detail ?? "backed up, not modified"}). Fix or remove the file and run ghostly install again.`,
      );
    } else if (result.status === "unsupported") {
      spin.stop(`${client.label} is not supported yet`);
    } else {
      spin.stop(`MCP server configured in ${client.label} ✓`);
      client.installGuidance?.();
      p.log.warn(
        `Restart required: ${client.restartHint ?? `restart or reload ${client.label} to pick up the new MCP server.`}`,
      );
    }
    return result;
  } catch (err) {
    spin.stop(`Failed to configure ${client.label}`);
    p.log.error(String(err));
    p.log.warn("You can add it manually — see the documentation.");
    return { status: "unsupported", detail: String(err) };
  }
}
