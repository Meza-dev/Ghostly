export const GHOSTLY_GUIDANCE_DESCRIPTION =
  "Use Ghostly's MCP tools to plan and run unit, integration and E2E tests and review security hygiene.";

/** Shared guide installed in each client's native format. */
export const GHOSTLY_GUIDANCE_MARKDOWN = `# Ghostly Expert Architect

Choose the Ghostly MCP tool that matches the user's intent.

| User intent | Tool and action |
| --- | --- |
| Find useful tests for the repository | Use \`ghostly_init\`. See [Code tests](#code-tests). |
| Test a unit or integration in a module | Use \`ghostly_test_unit\` or \`ghostly_test_integration\`. See [Code tests](#code-tests). |
| Generate a versionable browser persistence test | Use \`ghostly_test_e2e\` with a loopback origin, synthetic data and stable test IDs. Use the same \`{{runId}}\` template in the saved fill value and the exact record text checked after reload. Keep the save confirmation fixed. |
| Run or save a browser flow | Use \`ghostly_run_flow\` to validate the requested flow. Call \`submit_plan\` only when the user asks to save it. Resolve the project with \`list_ghostly_projects\` and check the saved run with \`get_run\`. |
| Review security hygiene | Use \`ghostly_audit_security\`. See [Defensive security review](#defensive-security-review). |

Save a validated flow with deterministic replay by default by omitting \`assistV2\`. Set \`assistV2: true\` only when the user asks for Ghostly's self-healing and judge supervision.

For browser selector discovery, use \`get_project_map\`, \`read_flow_docs\` and \`analyze_component\` as needed. Pass the absolute \`projectRoot\` to these tools and \`submit_plan\` when the MCP client runs outside the target project. Run browser flows against a test environment with synthetic data.

Report assertion failures as failures. If a selector is wrong, correct it and replay the same check. Return the generated test path and replay command, including any required environment settings. Proactively offer a relevant test when the user changes behavior.

## Code tests

1. Use the repository's configured runner, test directory and naming. The supported TypeScript setup requires a declared and installed \`tsx\` dependency, an existing flat test directory matching a script such as \`tsx --test test/*.test.ts\`, and \`node:test\`. If the tool returns \`unsupported\`, explain the mismatch and leave the suite and its configuration in place.
2. Use \`ghostly_init\` with \`mode: "plan"\` and no \`module\` for a read-only briefing. Present up to three options, their evidence and planned paths, and the recommendation. Explain missing inputs, an unsupported setup and uncertain coverage. Count only active assertions for the exact case.
3. Pass a relative \`module\` and \`plan\` or \`apply\` mode. Use \`ghostly_test_unit\` for a documented numeric \`@example\` or a documented inclusive numeric boundary returning a boolean. Use \`ghostly_test_integration\` for a numeric \`@integrationExample\` whose public operation calls a direct local TypeScript dependency. Use an expectation written independently of the implementation. Ask for the intended result if it is missing.
4. Report \`baseline.status\` and \`verification.status\` separately. Distinguish assertion failures, execution errors and \`no_tests\`. A passing test added for existing behavior adds coverage. For a regression fix, when feasible, observe the intended assertion fail on the buggy behavior and rerun the same assertion after the fix. Setup errors and unrelated baseline failures do not establish that regression.

Wait for the user to choose a ready option. Apply with its \`selection\`, \`planToken\` and the same \`scope\`, \`testType\`, \`layout\` and browser inputs used to plan. If an unfiltered briefing's B is already integration, “B, only integration” can also include \`testType: "integration"\` to confirm that same option. A new scope needs a fresh briefing. For “A next to the code”, explain that the current tool cannot apply a colocated layout. Ghostly rechecks the approval after the baseline and before writing. On \`plan_changed\`, explain any reported drift, show the new options and get a new selection. If your client supports delegation, it may help inspect the repository. The agent handling the request confirms and applies the same contract.

For example, call \`{"mode":"plan","scope":"src"}\`. If A is the documented \`src/eligibility.ts\` boundary and the user chooses A, call \`{"mode":"apply","scope":"src","selection":"A","planToken":"<returned token>"}\`. Replay the generated file from the repo root with \`node --import tsx --test test/eligibility.ghostly.test.ts\`.

See [Superpowers test-driven development](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) and the [Microsoft unit testing playbook](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/unit-testing/).

## Defensive security review

- Identify the language, framework and package manager from repository files and name that evidence in the review. Call \`ghostly_audit_security\` with an optional repo-relative file or directory as \`scope\`. Omit it to inspect the workspace. This bounded local read-only check looks for possible embedded credentials, explicit container or TLS settings, and dependency declarations and lockfile presence. It does not run code, query advisories or write reports to disk.
- Give each finding's repo-relative file and line, confidence, conditional impact and mitigation. Keep secret values and source excerpts out of the response. Include coverage and gaps when the result is \`partial\`. An empty result only describes what the configured checks observed.
- In a synthetic fixture, \`{"scope":"Dockerfile"}\` may report an explicit root user at \`Dockerfile:2\` with high confidence in the declaration. If that stage runs the app, root broadens in-container permissions. Verify the runtime stage and use a dedicated non-root user where possible. A workspace report can include that finding and still be \`partial\` if \`file-or-byte-limit\` left oversized files uninspected.

See [OpenAI security best practices](https://github.com/openai/skills/blob/main/skills/.curated/security-best-practices/SKILL.md).
`;

/**
 * Antepone frontmatter (YAML entre `---`) al cuerpo de la guía compartida. Cada adapter de
 * cliente arma sus propias líneas de frontmatter (Cursor: description/alwaysApply, Claude Code
 * SKILL.md: name/description) pero comparten este único body — evita 3 copias casi idénticas.
 */
export function renderGuidanceWithFrontmatter(frontmatterLines: string[]): string {
  return [...["---", ...frontmatterLines, "---", ""], GHOSTLY_GUIDANCE_MARKDOWN].join("\n");
}
