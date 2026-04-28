/** Base URL de la API GhostTester (sin barra final). */
export function apiUrlFromEnv(apiUrl?: string): string {
  return (apiUrl ?? process.env.GHOST_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}

/** Headers de auth: JWT → Bearer; API key de BD → X-Api-Key. */
export function authHeader(apiKey?: string): Record<string, string> {
  const token = apiKey ?? process.env.GHOST_API_KEY ?? process.env.GHOST_API_TOKEN;
  if (!token) return {};
  const isJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  return isJwt
    ? { Authorization: `Bearer ${token}` }
    : { "X-Api-Key": token };
}
