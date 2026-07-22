import { createHmac, timingSafeEqual } from "node:crypto";

/** Secretos por defecto públicos que NUNCA deben usarse para firmar JWT. */
const KNOWN_DEFAULT_SECRETS = new Set(["ghostly-secret"]);

/** Longitud mínima aceptable para el secreto de firma HMAC. */
const MIN_SECRET_LENGTH = 32;

/**
 * Resuelve el secreto JWT desde el entorno y falla si es inseguro (ausente,
 * demasiado corto o un default público conocido). Es la ÚNICA fuente de verdad
 * del secreto: `signToken`/`verifyToken` reciben el resultado de esta función.
 * Se usa tanto en el guard de arranque (index.ts) como por request.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH || KNOWN_DEFAULT_SECRETS.has(secret)) {
    throw new Error(
      `JWT_SECRET is required and must be at least ${MIN_SECRET_LENGTH} characters. ` +
        "Set a strong, random secret in the environment (.env) before starting the API.",
    );
  }
  return secret;
}

export type TokenPayload = {
  sub: string;   // userId
  email: string;
  role: string;
  iat: number;
  exp: number;
};

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">, secret: string, ttlSeconds = 86_400 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const full: TokenPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(full));
  const sig = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, secret);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) return null;
  } catch {
    return null;
  }
  const payload = JSON.parse(fromB64url(body)) as TokenPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
