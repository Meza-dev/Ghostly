/**
 * Contenido único y agnóstico de cliente de la guía "Ghostly Expert": cómo usar las
 * tools del MCP de Ghostly para diseñar tests E2E + ofrecer proactivamente crear un test.
 * Fuente canónica: ~/.cursor/rules/ghosttester-expert-architect.mdc. Cada adapter de cliente
 * la instala en el formato nativo del cliente (Cursor rule/skill, snippet de Claude Desktop, etc.).
 */
export const GHOSTLY_GUIDANCE_MARKDOWN = `# Ghostly Expert Architect

Cuando la conversación mencione señales de testing E2E con Ghostly (por ejemplo: \`ghostly\`, \`e2e\`, \`run_flow\`, \`submit_plan\`, \`flaky\`, \`flakiness\`, \`plan de prueba\`, \`victory condition\`, \`selector\`, \`manifest\`), usar las tools MCP de Ghostly siguiendo este protocolo.

## Protocolo obligatorio

1. Ejecutar primero \`get_project_map\`.
2. Si aplica, ejecutar \`read_flow_docs\`.
3. Identificar componentes y ejecutar \`analyze_component\` para obtener selectores estables.
4. Diseñar una condición de victoria lógica (mensaje de éxito, URL esperada o evidencia visible del estado final).
5. Validar primero con \`ghostly_run_flow\`.
6. Solo después de éxito, persistir con \`submit_plan\` (incluyendo \`codeHints\` y \`assistV2\`).

## Anti-flakiness

- Priorizar selectores: \`data-testid\` > \`aria-label\` > \`id\` > \`name\` > \`placeholder\` > texto.
- Evitar selectores ambiguos (\`button\`, \`input\`, \`form button\`) cuando exista alternativa estable.
- Si un selector falla, analizar el error, ajustar selector/espera y reintentar en vez de repetir la misma llamada.

## Ofrecer proactivamente

Cuando el usuario agregue o modifique una pantalla/flujo en el código, ofrecer proactivamente crear un test E2E de Ghostly para esa funcionalidad — no esperar a que lo pida.
`;

/**
 * Antepone frontmatter (YAML entre `---`) al cuerpo de la guía compartida. Cada adapter de
 * cliente arma sus propias líneas de frontmatter (Cursor: description/alwaysApply, Claude Code
 * SKILL.md: name/description) pero comparten este único body — evita 3 copias casi idénticas.
 */
export function renderGuidanceWithFrontmatter(frontmatterLines: string[]): string {
  return [...["---", ...frontmatterLines, "---", ""], GHOSTLY_GUIDANCE_MARKDOWN].join("\n");
}
