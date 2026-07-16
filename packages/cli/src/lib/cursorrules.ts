import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GHOST_RULES_MARKER = "# Ghostly — E2E Testing Agent";

const GHOST_RULES_BLOCK = `
${GHOST_RULES_MARKER}
## How to use Ghostly with Cursor

Ghostly exposes MCP tools to design and run E2E tests directly from the Cursor chat.

### Available tools

- **\`get_project_map\`** — Analyzes the project source code and returns a map of the available routes, components, and flows. Use it so the AI understands what's in the app before creating a test.

- **\`analyze_component\`** — Analyzes a specific component to obtain stable selectors (\`data-testid\`, \`aria-label\`, \`id\`) that avoid flaky tests.

- **\`read_flow_docs\`** — Reads the existing flow documentation for the current project.

- **\`ghostly_run_flow\`** — Runs a test flow in a real browser (Playwright). Takes a \`baseUrl\` and an array of steps in JSON.

- **\`submit_plan\`** — Persists a validated test plan for the project.

### Recommended workflow

1. Call \`get_project_map\` first to understand the app.
2. Use \`analyze_component\` for the flow's key components.
3. Design the test steps with stable selectors.
4. Validate with \`ghostly_run_flow\` before persisting.
5. Save the successful plan with \`submit_plan\`.

### Anti-flakiness

Prioritize selectors: \`data-testid\` > \`aria-label\` > \`id\` > \`name\` > visible text.
Avoid generic selectors like \`button\` or \`input\` without additional context.
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
