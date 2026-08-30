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

  // The pilot console is intentionally passwordless. In developer view, an
  // existing patient/email session must not shadow the explicitly configured
  // pilot identity, otherwise protected developer operations receive 403.
  if (view === "developer" && developerOpenAccessEnabled() && user?.source !== "development") {
    user = await developmentUser();
    if (authSessionSecret()) headers.set("set-cookie", sessionCookie(await createSessionToken(user)));
  }

  if (!user) return Response.json({ authenticated: false, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { status: 401 });
  return Response.json({ authenticated: true, user, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { headers });
}
