import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { ComponentInfo, FormInfo, FormInputInfo, ScanResult } from "./manifest-builder.js";

const SOURCE_GLOBS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
const EXCLUDE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/build/**",
  "**/*.spec.*",
  "**/*.test.*",
  "**/*.d.ts",
];

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function relativeFile(projectRoot: string, filePath: string): string {
  return toPosix(path.relative(projectRoot, filePath));
}

function fileBaseName(filePath: string): string {
  const base = path.basename(filePath);
  // Quitar doble extensión: Component.test.tsx → Component.test → Component
  return base.replace(/\.[^.]+$/, "").replace(/\.[^.]+$/, "");
}

async function getSourceFiles(projectRoot: string): Promise<string[]> {
  return glob(SOURCE_GLOBS, {
    cwd: projectRoot,
    absolute: true,
    ignore: EXCLUDE_GLOBS,
  });
}

// Extrae el valor literal de un atributo JSX: attr="val" | attr={'val'} | attr={`val`}
function extractAttrValue(src: string, attrStart: number): string | undefined {
  let i = attrStart;
  while (i < src.length && src[i] !== "=" && src[i] !== ">" && src[i] !== "\n") i++;
  if (src[i] !== "=") return undefined;
  i++;
  if (src[i] === '"' || src[i] === "'") {
    const q = src[i++];
    const end = src.indexOf(q, i);
    return end === -1 ? undefined : src.slice(i, end).trim();
  }
  if (src[i] === "{") {
    i++;
    if (src[i] === "'" || src[i] === '"' || src[i] === "`") {
      const q = src[i++];
      const end = src.indexOf(q, i);
      return end === -1 ? undefined : src.slice(i, end).trim();
    }
  }
  return undefined;
}

// Nombre del componente React más cercano antes de `pos`
function findComponentName(src: string, pos: number, fallback: string): string {
  const before = src.slice(0, pos);
  const COMP_RE = /(?:function|class)\s+([A-Z][A-Za-z0-9_]*)[\s({]|(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g;
  let last: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = COMP_RE.exec(before)) !== null) {
    last = match[1] ?? match[2];
  }
  return last ?? fallback;
}

// Detecta si `pos` está dentro de un <form ...>...</form>
function isInsideForm(src: string, pos: number): boolean {
  const before = src.slice(0, pos);
  const lastOpen = before.lastIndexOf("<form");
  const lastClose = before.lastIndexOf("</form>");
  return lastOpen !== -1 && lastOpen > lastClose;
}

// Extrae un atributo inline de un bloque de atributos (string de attrs ya extraído)
function inlineAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}=(?:"([^"]*?)"|'([^']*?)'|\\{['\`"]([^'"\`]*?)['\`"]\\})`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

interface ParsedFile {
  components: ComponentInfo[];
  forms: FormInfo[];
}

function parseFile(filePath: string, src: string, projectRoot: string): ParsedFile {
  const file = relativeFile(projectRoot, filePath);
  const fallback = fileBaseName(filePath);

  const components = new Map<string, ComponentInfo>();
  const forms = new Map<string, FormInfo>();

  const ensureComponent = (name: string): ComponentInfo => {
    const key = `${file}#${name}`;
    if (!components.has(key)) {
      components.set(key, { name, file, testIds: [], ariaLabels: [], roles: [] });
    }
    return components.get(key)!;
  };

  const ensureForm = (name: string): FormInfo => {
    const key = `${file}#${name}`;
    if (!forms.has(key)) forms.set(key, { name, file, inputs: [] });
    return forms.get(key)!;
  };

  const mergeInput = (form: FormInfo, input: FormInputInfo): void => {
    const key = input.testId ?? input.ariaLabel ?? input.name ?? input.id ?? input.placeholder;
    if (key && form.inputs.some((e) =>
      [e.testId, e.ariaLabel, e.name, e.id, e.placeholder].includes(key),
    )) return;
    form.inputs.push(input);
  };

  // ── data-testid / aria-label / role ────────────────────────────────────────
  const ATTR_RE = /\b(data-testid|aria-label|role)(?==)/g;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src)) !== null) {
    const value = extractAttrValue(src, m.index + m[1].length);
    if (!value) continue;
    const comp = ensureComponent(findComponentName(src, m.index, fallback));
    if (m[1] === "data-testid") comp.testIds.push(value);
    else if (m[1] === "aria-label") comp.ariaLabels.push(value);
    else if (m[1] === "role") comp.roles.push(value);
  }

  // ── <input | <textarea | <select ───────────────────────────────────────────
  const INPUT_RE = /<(input|textarea|select)\b([^>]*?)(?:\/?>)/gis;
  while ((m = INPUT_RE.exec(src)) !== null) {
    const attrs = m[2];
    const compName = findComponentName(src, m.index, fallback);
    const formName = isInsideForm(src, m.index)
      ? compName
      : compName.toLowerCase().includes("form") ? compName : `${compName}Form`;

    const input: FormInputInfo = {
      ...(inlineAttr(attrs, "data-testid") ? { testId: inlineAttr(attrs, "data-testid") } : {}),
      ...(inlineAttr(attrs, "aria-label") ? { ariaLabel: inlineAttr(attrs, "aria-label") } : {}),
      ...(inlineAttr(attrs, "id") ? { id: inlineAttr(attrs, "id") } : {}),
      ...(inlineAttr(attrs, "name") ? { name: inlineAttr(attrs, "name") } : {}),
      ...(inlineAttr(attrs, "placeholder") ? { placeholder: inlineAttr(attrs, "placeholder") } : {}),
      type: inlineAttr(attrs, "type") ?? "text",
    };
    mergeInput(ensureForm(formName), input);
  }

  // ── <button type="submit" ──────────────────────────────────────────────────
  const BTN_RE = /<[Bb]utton\b([^>]*?)(?:>|$)/gms;
  while ((m = BTN_RE.exec(src)) !== null) {
    const attrs = m[1];
    const isSubmit = /type=["'`]submit["'`]/.test(attrs)
      || /type=\{["'`]submit["'`]\}/.test(attrs);
    if (!isSubmit) continue;

    const compName = findComponentName(src, m.index, fallback);
    const formName = isInsideForm(src, m.index)
      ? compName
      : compName.toLowerCase().includes("form") ? compName : `${compName}Form`;

    const form = ensureForm(formName);
    const testId = /data-testid=["']([^"']+)["']/.exec(attrs)?.[1];
    const ariaLabel = /aria-label=["']([^"']+)["']/.exec(attrs)?.[1];
    if (testId && !form.submitTestId) form.submitTestId = testId;
    if (ariaLabel && !form.submitLabel) form.submitLabel = ariaLabel;
  }

  return {
    components: Array.from(components.values()),
    forms: Array.from(forms.values()).filter((f) => f.inputs.length > 0),
  };
}

export async function walkAst(projectRoot: string): Promise<ScanResult> {
  const root = path.resolve(projectRoot);
  const files = await getSourceFiles(root);

  const allComponents = new Map<string, ComponentInfo>();
  const allForms = new Map<string, FormInfo>();

  // Procesamiento secuencial: un archivo a la vez para minimizar uso de memoria
  for (const filePath of files) {
    let src: string;
    try {
      src = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const { components, forms } = parseFile(filePath, src, root);

    for (const comp of components) {
      const key = `${comp.file}#${comp.name}`;
      const existing = allComponents.get(key);
      if (existing) {
        existing.testIds.push(...comp.testIds);
        existing.ariaLabels.push(...comp.ariaLabels);
        existing.roles.push(...comp.roles);
      } else {
        allComponents.set(key, comp);
      }
    }

    for (const form of forms) {
      const key = `${form.file}#${form.name}`;
      if (!allForms.has(key)) allForms.set(key, form);
    }
  }

  return {
    components: Array.from(allComponents.values()),
    forms: Array.from(allForms.values()),
  };
}
