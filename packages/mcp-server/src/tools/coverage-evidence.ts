import path from "node:path";

type DirectCase = { evidence: { file: string }; functionName: string; argument: number; expected: number | boolean };
type Import = { specifier: string; bindings: string[] };

// Recognize a deliberately small test grammar. Unsupported syntax can never prove coverage.
const lex = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\])*`|[a-zA-Z_$][\w$]*|-?\d+(?:\.\d+)?|=>|\S/g;

function topLevel(tokens: string[]): number[] {
  const indices: number[] = [];
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    if (depth === 0) indices.push(index);
    if (["{", "(", "["].includes(token)) depth++;
    if (["}", ")", "]"].includes(token)) depth--;
  }
  return indices;
}

function importsAt(tokens: string[], indices: number[]): Import[] {
  return indices.flatMap((index) => {
    if (tokens[index] !== "import") return [];
    const from = tokens.indexOf("from", index + 1);
    const specifier = tokens[from + 1];
    if (from < 0 || !specifier || !/^["'][^"'\\]+["']$/.test(specifier)) return [];
    const bindings = tokens.slice(index + 1, from);
    if (!bindings.length || bindings.some((token) => !/^(?:[a-zA-Z_$][\w$]*|[{},*])$/.test(token))) return [];
    return [{ specifier: specifier.slice(1, -1), bindings }];
  });
}

function namedBinding(bindings: string[], exported: string): string | undefined {
  const start = bindings.indexOf("{");
  const end = bindings.indexOf("}");
  if (start < 0 || end < start) return;
  let index = start + 1;
  while (index < end) {
    const separator = bindings.indexOf(",", index);
    const next = separator < 0 ? end : separator;
    const entry = bindings.slice(index, next);
    if (entry[0] === exported) {
      if (entry.length === 1) return exported;
      if (entry.length === 3 && entry[1] === "as") return entry[2];
    }
    index = next + 1;
  }
}

function matchesAt(tokens: string[], start: number, pattern: string[]): boolean {
  return pattern.every((token, index) => tokens[start + index] === token);
}

function hasActiveAssertion(
  tokens: string[], indices: number[], test: string, assertion: string[],
): boolean {
  return indices.some((index) => {
    const previous = tokens[index - 1];
    if (previous !== undefined && previous !== ";" && previous !== "}") return false;
    const title = tokens[index + 2];
    if (tokens[index] !== test || tokens[index + 1] !== "(" || !title || !/^["']/.test(title)) return false;
    if (!matchesAt(tokens, index + 3, [",", "(", ")", "=>"])) return false;
    const start = index + 7;
    return matchesAt(tokens, start, [...assertion, ")"]) ||
      matchesAt(tokens, start, ["{", ...assertion, ";", "}", ")"]) ||
      matchesAt(tokens, start, ["{", ...assertion, "}", ")"]);
  });
}

export function inspectTestReference(testFile: string, source: string, candidate: DirectCase) {
  const tokens = (source.match(lex) ?? []).filter((token) => !/^\/[*\/]/.test(token));
  const indices = topLevel(tokens);
  const imports = importsAt(tokens, indices);
  const moduleImports = imports.filter(({ specifier }) => specifier.startsWith(".") &&
    path.posix.normalize(path.posix.join(path.posix.dirname(testFile), specifier))
      .replace(/\.[cm]?[jt]s$/, "") === candidate.evidence.file.replace(/\.ts$/, ""));
  const binding = moduleImports.map(({ bindings }) => namedBinding(bindings, candidate.functionName)).find(Boolean);
  const referenced = Boolean(binding) || moduleImports.some(({ bindings }) => bindings.includes("*"));
  const testImport = imports.find(({ specifier }) => specifier === "node:test");
  const test = testImport && namedBinding(testImport.bindings, "test");
  const assertImport = imports.find(({ specifier }) => specifier === "node:assert/strict");
  const assert = assertImport?.bindings[0];
  if (!binding || !test || !assert || assertImport?.bindings.length !== 1 ||
    tokens.some((token) => token === "/" || token.startsWith("`"))) return { referenced, covered: false };

  const tail = ["(", binding, "(", String(candidate.argument), ")", ",", String(candidate.expected), ")"];
  const covered = ["strictEqual", "equal"].some((method) =>
    hasActiveAssertion(tokens, indices, test, [assert, ".", method, ...tail]));
  return { referenced, covered };
}
