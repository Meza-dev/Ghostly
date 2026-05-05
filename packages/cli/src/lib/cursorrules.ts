import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GHOST_RULES_MARKER = "# Ghostly — E2E Testing Agent";

const GHOST_RULES_BLOCK = `
${GHOST_RULES_MARKER}
## Cómo usar Ghostly con Cursor

Ghostly expone herramientas MCP para diseñar y ejecutar tests E2E directamente desde el chat de Cursor.

### Herramientas disponibles

- **\`get_project_map\`** — Analiza el código fuente del proyecto y devuelve un mapa de rutas, componentes y flujos disponibles. Úsala para que la IA entienda qué hay en la app antes de crear un test.

- **\`analyze_component\`** — Analiza un componente específico para obtener selectores estables (\`data-testid\`, \`aria-label\`, \`id\`) que eviten tests frágiles.

- **\`read_flow_docs\`** — Lee la documentación de flujos existentes para el proyecto actual.

- **\`ghostly_run_flow\`** — Ejecuta un flujo de prueba en un navegador real (Playwright). Recibe una \`baseUrl\` y un array de pasos en JSON.

- **\`submit_plan\`** — Persiste un plan de prueba validado para el proyecto.

### Flujo recomendado

1. Primero llamar \`get_project_map\` para entender la app.
2. Usar \`analyze_component\` para los componentes clave del flujo.
3. Diseñar los pasos del test con selectores estables.
4. Validar con \`ghostly_run_flow\` antes de persistir.
5. Guardar el plan exitoso con \`submit_plan\`.

### Anti-flakiness

Priorizar selectores: \`data-testid\` > \`aria-label\` > \`id\` > \`name\` > texto visible.
Evitar selectores genéricos como \`button\` o \`input\` sin contexto adicional.
`;

export function appendGhostRules(projectDir: string): "added" | "exists" | "error" {
  const rulesPath = resolve(projectDir, ".cursorrules");
  try {
    if (existsSync(rulesPath)) {
      const existing = readFileSync(rulesPath, "utf8");
      if (existing.includes(GHOST_RULES_MARKER)) return "exists";
      writeFileSync(rulesPath, existing + "\n" + GHOST_RULES_BLOCK, "utf8");
    } else {
      writeFileSync(rulesPath, GHOST_RULES_BLOCK.trimStart(), "utf8");
    }
    return "added";
  } catch {
    return "error";
  }
}
