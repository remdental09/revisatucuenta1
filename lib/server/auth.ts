export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  source: "chatgpt" | "email" | "development" | "pilot";
};

type SignedTokenPurpose = "magic_link" | "session";

type SignedTokenPayload = {
  purpose: SignedTokenPurpose;
  userId?: string;
  email: string;
  displayName?: string;
  source?: AuthenticatedUser["source"];
  issuedAt: number;
  expiresAt: number;
};

const SESSION_COOKIE = "rtc_session";
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAGIC_LINK_DURATION_SECONDS = 15 * 60;

function runtimeEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlToString(value: string) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAuthToken(payload: SignedTokenPayload, secret: string) {
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAuthToken(
  token: string,
  secret: string,
  expectedPurpose: SignedTokenPurpose,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SignedTokenPayload | undefined> {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return;
  let signature: Uint8Array;
  let payload: SignedTokenPayload;
  try {
    signature = base64UrlToBytes(encodedSignature);
    payload = JSON.parse(base64UrlToString(encodedPayload)) as SignedTokenPayload;
  } catch {
    return;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature as unknown as BufferSource,
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid || payload.purpose !== expectedPurpose) return;
  if (!payload.email || !Number.isFinite(payload.expiresAt) || payload.expiresAt < nowSeconds) return;
  if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > nowSeconds + 60) return;
  return payload;
}

export function authSessionSecret() {
  return runtimeEnv("AUTH_SESSION_SECRET");
}

export function emailAuthenticationConfigured() {
  return Boolean(authSessionSecret() && runtimeEnv("RESEND_API_KEY") && runtimeEnv("AUTH_EMAIL_FROM"));
}

export function pilotAuthenticationConfigured() {
  return Boolean(authSessionSecret() && runtimeEnv("REVISA_PILOT_ACCESS_KEY"));
}

export function developmentAuthenticationEnabled() {
  return runtimeEnv("NODE_ENV") !== "production" && runtimeEnv("REVISA_AUTH_DEV_MODE") === "true";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function emailUserId(email: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email)));
  return `email:${bytesToBase64Url(new Uint8Array(digest))}`;
}

export async function createMagicLinkToken(email: string, displayName?: string) {
  const secret = authSessionSecret();
  if (!secret) throw new Error("La autenticación por correo no está configurada");
  const now = Math.floor(Date.now() / 1000);
  return signAuthToken({
    purpose: "magic_link",
    email: normalizeEmail(email),
    displayName: displayName?.trim() || undefined,
    issuedAt: now,
    expiresAt: now + MAGIC_LINK_DURATION_SECONDS,
  }, secret);
}

export async function magicLinkUser(token: string): Promise<AuthenticatedUser | undefined> {
  const secret = authSessionSecret();
  if (!secret) return;
  const payload = await verifyAuthToken(token, secret, "magic_link");
  if (!payload) return;
  return {
    id: await emailUserId(payload.email),
    email: normalizeEmail(payload.email),
    displayName: payload.displayName || payload.email,
    source: "email",
  };
}

function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function pilotUser(accessKey: string): Promise<AuthenticatedUser | undefined> {
  const configuredKey = runtimeEnv("REVISA_PILOT_ACCESS_KEY");
  if (!configuredKey || !authSessionSecret() || !safeEqual(accessKey.trim(), configuredKey)) return;
  const email = normalizeEmail(runtimeEnv("REVISA_AUTH_DEV_EMAIL") || "piloto@revisatucuenta.local");
  return {
    id: `pilot:${(await emailUserId(email)).slice("email:".length)}`,
    email,
    displayName: "Piloto RevisaTuCuenta",
    source: "pilot",
  };
}

export async function createSessionToken(user: AuthenticatedUser) {
  const secret = authSessionSecret();
  if (!secret) throw new Error("La sesión no está configurada");
  const now = Math.floor(Date.now() / 1000);
  return signAuthToken({
    purpose: "session",
    userId: user.id,
    email: normalizeEmail(user.email),
    displayName: user.displayName,
    source: user.source,
    issuedAt: now,
    expiresAt: now + SESSION_DURATION_SECONDS,
  }, secret);
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | undefined> {
  const chatGptId = request.headers.get("oai-authenticated-user-id")?.trim();
  const chatGptEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (chatGptId && chatGptEmail) {
    const encodedName = request.headers.get("oai-authenticated-user-full-name");
    const displayName = encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? safeDecode(encodedName) || chatGptEmail
      : chatGptEmail;
    return { id: `chatgpt:${chatGptId}`, email: chatGptEmail, displayName, source: "chatgpt" };
  }

  const secret = authSessionSecret();
  const token = cookieValue(request, SESSION_COOKIE);
  if (secret && token) {
    const payload = await verifyAuthToken(token, secret, "session");
    if (payload?.userId) {
      return {
        id: payload.userId,
        email: normalizeEmail(payload.email),
        displayName: payload.displayName || payload.email,
        source: payload.source || "email",
      };
    }
  }

  if (developmentAuthenticationEnabled()) {
    const email = normalizeEmail(runtimeEnv("REVISA_AUTH_DEV_EMAIL") || "desarrollo@revisatucuenta.local");
    return { id: await emailUserId(email), email, displayName: "Desarrollo local", source: "development" };
  }
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return undefined; }
}

export async function requireApiUser(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (user) return { user } as const;
  return {
    response: Response.json(
      { error: "Debes verificar tu correo o usar la clave de piloto para acceder al expediente", code: "authentication_required" },
      { status: 401 },
    ),
  } as const;
}

export function isDeveloperUser(user: AuthenticatedUser) {
  if (user.source === "development" && developmentAuthenticationEnabled()) return true;
  if (user.source === "pilot" && pilotAuthenticationConfigured()) return true;
  const allowed = (runtimeEnv("REVISA_DEVELOPER_EMAILS") || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return allowed.includes(normalizeEmail(user.email));
}

export function sessionCookie(token: string, secure = runtimeEnv("NODE_ENV") === "production") {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearedSessionCookie(secure = runtimeEnv("NODE_ENV") === "production") {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}
