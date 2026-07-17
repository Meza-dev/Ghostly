import fs from "node:fs";
import path from "node:path";
import type { RouteInfo } from "./manifest-builder.js";

const ROUTE_FILE_CANDIDATES = [
  "src/routes.tsx",
  "src/routes.jsx",
  "src/routes.ts",
  "src/routes.js",
  "src/router.tsx",
  "src/router.jsx",
  "src/router.ts",
  "src/router.js",
  "src/App.tsx",
  "src/App.jsx",
  "src/app.tsx",
  "src/app.jsx",
  "apps/web/src/App.tsx",
  "apps/web/src/App.jsx",
  "apps/web/src/routes.tsx",
  "apps/web/src/routes.jsx",
  "apps/web/src/router.tsx",
  "apps/web/src/router.jsx",
  "app/routes.tsx",
  "app/routes.jsx",
];

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

// Extrae la ruta del atributo path de un <Route>
// Soporta: path="/foo" | path={'/foo'} | path={`/foo`}
function extractPathAttr(attrs: string): string | undefined {
  const m = /\bpath=(?:"([^"]+?)"|'([^']+?)'|\{[`'"]([^`'"]+?)[`'"]\})/.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

// Extrae el nombre del componente del atributo element o component
// element={<ComponentName} | element={<ComponentName />} | component={ComponentName}
function extractComponentAttr(attrs: string): string | undefined {
  // element={<ComponentName o element={<ComponentName />
  const elementM = /\belement=\{<([A-Z][A-Za-z0-9_.]*)/.exec(attrs);
  if (elementM) return elementM[1];
  // component={ComponentName}
  const compM = /\bcomponent=\{([A-Z][A-Za-z0-9_.]*)/.exec(attrs);
  if (compM) return compM[1];
  // component="ComponentName"
  const compStr = /\bcomponent=["']([A-Z][A-Za-z0-9_.]*)["']/.exec(attrs);
  if (compStr) return compStr[1];
  return undefined;
}

// Extrae rutas desde el contenido de un archivo buscando <Route ... />
function extractRoutesFromSource(src: string, filePath: string, projectRoot: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const relFile = toPosix(path.relative(projectRoot, filePath));

  // Capturar tags <Route con sus atributos (puede abarcar varias líneas)
  const ROUTE_RE = /<Route\b([\s\S]*?)(?:\/?>)/g;
  let m: RegExpExecArray | null;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    const attrs = m[1];
    if (attrs === undefined) continue;
    const routePath = extractPathAttr(attrs);
    if (!routePath) continue;

    const component = extractComponentAttr(attrs);
    routes.push({
      path: routePath,
      ...(component ? { component: component.includes(".") ? component : `${relFile}#${component}` } : {}),
    });
  }

  return routes;
}

function resolveCandidates(projectRoot: string): string[] {
  const candidates = ROUTE_FILE_CANDIDATES
    .map((c) => path.join(projectRoot, c))
    .filter((f) => fs.existsSync(f));

  return candidates.length > 0 ? candidates : [];
}

export function extractRoutes(projectRoot: string): RouteInfo[] {
  const root = path.resolve(projectRoot);
  const files = resolveCandidates(root);
  const routes: RouteInfo[] = [];

  for (const filePath of files) {
    try {
      const src = fs.readFileSync(filePath, "utf8");
      routes.push(...extractRoutesFromSource(src, filePath, root));
    } catch {
      // Archivo no legible — ignorar
    }
  }

  // Deduplicar por path
  const seen = new Set<string>();
  return routes.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
}
