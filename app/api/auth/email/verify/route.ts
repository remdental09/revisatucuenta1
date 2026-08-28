import { createSessionToken, magicLinkUser, sessionCookie } from "../../../../../lib/server/auth.ts";

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
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const user = await magicLinkUser(token);
  if (!user) return new Response("El enlace de acceso es inválido o venció.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const session = await createSessionToken(user);
  const response = Response.redirect(new URL(safeReturnTo(url.searchParams.get("returnTo")), url.origin), 303);
  response.headers.append("set-cookie", sessionCookie(session, url.protocol === "https:"));
  return response;
}
