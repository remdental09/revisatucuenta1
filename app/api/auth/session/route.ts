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

  // Keep a session created by the developer-key gate out of the patient
  // surface. A real email session remains valid even when that email also
  // belongs to an administrator; otherwise administrators cannot test or use
  // the patient flow with their verified address.
  if (view === "patient" && user?.source === "development") user = undefined;
  if (view === "developer" && user && !isDeveloperUser(user)) user = undefined;

  if (!user) return Response.json({ authenticated: false, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { status: 401 });
  return Response.json({ authenticated: true, user, developerOpen: view === "developer" && developerOpenAccessEnabled() }, { headers });
}
