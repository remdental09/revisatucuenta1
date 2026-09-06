import {
  authSessionSecret,
  createSessionToken,
  developerUserFromKey,
  sessionCookie,
} from "../../../../lib/server/auth.ts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key : "";
  const user = developerUserFromKey(key);

  // Keep the response deliberately generic so the public gate does not reveal
  // whether a submitted value is close to a configured developer key.
  if (!user) {
    return Response.json({ error: "La clave de desarrollador no es válida" }, { status: 401 });
  }

  if (!authSessionSecret()) {
    return Response.json({ error: "El acceso de desarrollador aún no está configurado" }, { status: 503 });
  }

  const token = await createSessionToken(user);
  return Response.json(
    { authenticated: true, user },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": sessionCookie(token),
      },
    },
  );
}
