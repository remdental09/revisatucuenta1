import {
  authSessionSecret,
  createSessionToken,
  developerOpenAccessEnabled,
  developmentUser,
  getAuthenticatedUser,
  sessionCookie,
} from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  let user = await getAuthenticatedUser(request);
  const view = new URL(request.url).searchParams.get("view");
  const headers = new Headers();

  // A developer/pilot session is intentionally scoped to the internal
  // console. It must never silently authenticate the patient-facing portal.
  if (view === "patient" && user?.source === "development") {
    user = undefined;
  }

  // The pilot console is intentionally passwordless. Issue the same signed
  // session used by the protected APIs, but only after an explicit developer
  // entry request and only when the deployment has opted into open dev mode.
  if (!user && view === "developer" && developerOpenAccessEnabled()) {
    if (!authSessionSecret()) {
      return Response.json(
        { error: "La consola de desarrollo está abierta, pero falta AUTH_SESSION_SECRET" },
        { status: 503 },
      );
    }
    user = await developmentUser();
    headers.set("set-cookie", sessionCookie(await createSessionToken(user)));
  }

  if (!user) return Response.json({ authenticated: false, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { status: 401 });
  return Response.json({ authenticated: true, user, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { headers });
}
