import { createMagicLinkToken, developmentAuthenticationEnabled, emailAuthenticationConfigured } from "../../../../../lib/server/auth.ts";
import { sendAccessLink } from "../../../../../lib/server/email.ts";

type AttemptState = Map<string, number[]>;
const runtime = globalThis as typeof globalThis & { __revisaAuthAttempts?: AttemptState };
const attempts = runtime.__revisaAuthAttempts ??= new Map<string, number[]>();

function allowedAttempt(key: string) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 5) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/?view=patient";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/?view=patient";
  } catch {
    return "/?view=patient";
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: string; displayName?: string; returnTo?: string };
  const email = body.email?.trim().toLowerCase() || "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Ingresa un correo electrónico válido" }, { status: 422 });
  const remote = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowedAttempt(`${remote}:${email}`)) return Response.json({ error: "Espera unos minutos antes de solicitar otro enlace" }, { status: 429 });

  if (!emailAuthenticationConfigured() && !developmentAuthenticationEnabled()) {
    return Response.json({ error: "El acceso por correo aún no está configurado en este entorno", code: "email_auth_not_configured" }, { status: 503 });
  }

  const token = await createMagicLinkToken(email, body.displayName);
  const returnTo = safeReturnTo(body.returnTo);
  const publicOrigin = typeof process !== "undefined" && process.env.REVISA_PUBLIC_URL?.trim()
    ? process.env.REVISA_PUBLIC_URL.trim().replace(/\/$/, "")
    : new URL(request.url).origin;
  const verifyUrl = `${publicOrigin}/api/auth/email/verify?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(returnTo)}`;

  if (emailAuthenticationConfigured()) await sendAccessLink({ email, url: verifyUrl });
  return Response.json({
    sent: true,
    message: "Revisa tu correo para ingresar al expediente.",
    ...(developmentAuthenticationEnabled() ? { developmentVerifyUrl: verifyUrl } : {}),
  });
}
