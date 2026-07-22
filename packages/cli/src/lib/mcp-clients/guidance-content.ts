/**
 * Contenido único y agnóstico de cliente de la guía "Ghostly Expert": cómo usar las
 * tools del MCP de Ghostly para diseñar tests E2E + ofrecer proactivamente crear un test.
 * Fuente canónica: ~/.cursor/rules/ghosttester-expert-architect.mdc. Cada adapter de cliente
 * la instala en el formato nativo del cliente (Cursor rule/skill, snippet de Claude Desktop, etc.).
 */
export const GHOSTLY_GUIDANCE_MARKDOWN = `# Ghostly Expert Architect

When the conversation mentions E2E testing signals for Ghostly (for example: \`ghostly\`, \`e2e\`, \`run_flow\`, \`submit_plan\`, \`flaky\`, \`flakiness\`, \`test plan\`, \`victory condition\`, \`selector\`, \`manifest\`), use Ghostly's MCP tools following this protocol.

## Required protocol

1. Run \`get_project_map\` first.
2. If applicable, run \`read_flow_docs\`.
3. Identify the components and run \`analyze_component\` to obtain stable selectors.
4. Design a logical victory condition (a success message, expected URL, or visible evidence of the final state).
5. Validate first with \`ghostly_run_flow\`.
6. Only after success, persist with \`submit_plan\` (including \`codeHints\` and \`assistV2\`).

## Anti-flakiness

- Selector priority: \`data-testid\` > \`aria-label\` > \`id\` > \`name\` > \`placeholder\` > text.
- Avoid ambiguous selectors (\`button\`, \`input\`, \`form button\`) when a stable alternative exists.
- If a selector fails, analyze the error, adjust the selector/wait, and retry instead of repeating the same call.

## Offer proactively

When the user adds or modifies a screen/flow in the code, proactively offer to create a Ghostly E2E test for that functionality — don't wait to be asked.
`;

/**
 * Antepone frontmatter (YAML entre `---`) al cuerpo de la guía compartida. Cada adapter de
 * cliente arma sus propias líneas de frontmatter (Cursor: description/alwaysApply, Claude Code
 * SKILL.md: name/description) pero comparten este único body — evita 3 copias casi idénticas.
 */
export function renderGuidanceWithFrontmatter(frontmatterLines: string[]): string {
  return [...["---", ...frontmatterLines, "---", ""], GHOSTLY_GUIDANCE_MARKDOWN].join("\n");
}
