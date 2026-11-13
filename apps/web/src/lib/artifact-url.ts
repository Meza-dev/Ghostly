export function artifactUrl(filePath: string, token: string | null): string | undefined {
  const segments = filePath.replace(/\\/g, "/").split("/");
  const file = segments.at(-1);
  const run = segments.at(-2);
  if (!file || file === "." || file === ".." || !run || !/^run-[\w-]+$/.test(run)) return undefined;
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  return `/artifacts/${run}/${encodeURIComponent(file)}${suffix}`;
}
