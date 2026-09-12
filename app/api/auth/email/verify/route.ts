import { createSessionToken, magicLinkUser, sessionCookie } from "../../../../../lib/server/auth.ts";
import { getCloudflareEnv } from "../../../../../lib/server/runtime-store.ts";

// Every click carries a different token.  Keep this handler out of the
// framework/CDN static-response path: otherwise the first invalid or expired
// click can be reused as the response for later, valid links.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeReturnTo(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/?view=patient";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/?view=patient";
  } catch {
    return "/?view=patient";
  }
}

export async function GET(request: Request) {
  await getCloudflareEnv();
  const url = new URL(request.url);
  // Some mail clients insert line breaks when copying long links.  Whitespace
  // is not part of our base64url token, so removing it is safe and keeps the
  // signed value intact.
  const token = (url.searchParams.get("token") || "").replace(/\s+/g, "");
  const user = await magicLinkUser(token);
  if (!user) return new Response("El enlace de acceso es inválido o venció.", {
    status: 400,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
    },
  });
  const session = await createSessionToken(user);
  // Response.redirect() exposes immutable headers in Node/Undici. Build a
  // fresh response so the session cookie can be added before redirecting.
  const headers = new Headers({
    location: new URL(safeReturnTo(url.searchParams.get("returnTo")), url.origin).toString(),
    "cache-control": "no-store",
  });
  headers.append("set-cookie", sessionCookie(session, url.protocol === "https:"));
  return new Response(null, { status: 303, headers });
}
