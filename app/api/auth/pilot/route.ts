import { createSessionToken, pilotAuthenticationConfigured, pilotUser, sessionCookie } from "../../../../lib/server/auth.ts";

export async function POST(request: Request) {
  if (!pilotAuthenticationConfigured()) {
    return Response.json({ error: "El acceso de piloto no está habilitado en este entorno" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const accessKey = typeof body?.key === "string" ? body.key : "";
  const user = await pilotUser(accessKey);
  if (!user) return Response.json({ error: "La clave de piloto no es válida" }, { status: 401 });

  const token = await createSessionToken(user);
  return Response.json({ authenticated: true, user }, { headers: { "set-cookie": sessionCookie(token, true) } });
}
