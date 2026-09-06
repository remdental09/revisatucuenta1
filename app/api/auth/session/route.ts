import {
  authSessionSecret,
  createSessionToken,
  developerOpenAccessEnabled,
  developmentUser,
  getAuthenticatedUser,
  isDeveloperUser,
  sessionCookie,
} from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  let user = await getAuthenticatedUser(request);
  const view = new URL(request.url).searchParams.get("view");
  const headers = new Headers();

  // The pilot console is intentionally passwordless. In developer view, an
  // existing patient/email session must not shadow the explicitly configured
  // pilot identity, otherwise protected developer operations receive 403.
  if (view === "developer" && developerOpenAccessEnabled() && user?.source !== "development") {
    user = await developmentUser();
    if (authSessionSecret()) headers.set("set-cookie", sessionCookie(await createSessionToken(user)));
  }

  // Keep the surfaces mutually exclusive. An administrator opening the
  // patient URL must authenticate as a patient, while a verified patient
  // opening the developer URL must not inherit a developer console session.
  if (view === "patient" && user && isDeveloperUser(user)) user = undefined;
  if (view === "developer" && user && !isDeveloperUser(user)) user = undefined;

  if (!user) return Response.json({ authenticated: false, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { status: 401 });
  return Response.json({ authenticated: true, user, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { headers });
}
