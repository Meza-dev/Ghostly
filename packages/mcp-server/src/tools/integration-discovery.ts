import path from "node:path";
import { modulePattern, type SupportedCase } from "./unit-discovery.js";

type IntegrationCase = SupportedCase & {
  dependency: { file: string; exportedName: string };
};

const identifier = String.raw`[a-zA-Z_$][\w$]*`;
const numericLiteral = String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?`;
// Match a written expectation, its export, and a return expression that calls a dependency.
const examples = new RegExp([
  String.raw`(?:^|\n)[ \t]*/\*\*[ \t]*@integrationExample[ \t]+`,
  String.raw`(?<name>${identifier})\((?<input>${numericLiteral})\)[ \t]*=>[ \t]*(?<result>${numericLiteral})[ \t]*\*/`,
  String.raw`\s*export\s+function\s+\k<name>\s*\(\s*(?<parameter>${identifier})\s*:\s*number\s*\)\s*:\s*number\s*\{`,
  String.raw`\s*return\s+(?:\k<parameter>\s*[-+*/]\s*)?(?<calledName>${identifier})\(\s*\k<parameter>\s*\)\s*;?\s*\}`,
].join(""), "g");
const imports = /(?:^|\n)[ \t]*import\s+\{([^}]+)\}\s+from\s+["'](\.{1,2}\/[^"'\r\n]+)["']/g;

export function integrationCaseFromSource(module: string, source: string): IntegrationCase | undefined {
  for (const example of source.matchAll(examples)) {
    const { name: functionName, input, result, calledName } = example.groups ?? {};
    const argument = Number(input);
    const expected = Number(result);
    if (!functionName || !calledName || !Number.isFinite(argument) || !Number.isFinite(expected)) continue;

    for (const [, bindings, specifier] of source.matchAll(imports)) {
      if (!bindings || !specifier?.endsWith(".ts")) continue;
      const file = path.posix.normalize(path.posix.join(path.posix.dirname(module), specifier));
      if (file === module || !modulePattern.test(file)) continue;
      for (const binding of bindings.split(",")) {
        const names = /^\s*([a-zA-Z_$][\w$]*)(?:\s+as\s+([a-zA-Z_$][\w$]*))?\s*$/.exec(binding);
        const exportedName = names?.[1];
        if (!exportedName || (names?.[2] ?? exportedName) !== calledName) continue;
        return {
          evidence: {
            file: module,
            line: source.slice(0, example.index + example[0].indexOf("@integrationExample")).split("\n").length,
          },
          dependency: { file, exportedName },
          functionName,
          argument,
          expected,
          behavior: `${functionName}(${argument}) returns ${expected} through ${exportedName}`,
          reason: "The public operation documents the expected result and calls a separate local module.",
          assertion: `assert.strictEqual(${functionName}(${argument}), ${expected})`,
        };
      }
    }
  }
}
