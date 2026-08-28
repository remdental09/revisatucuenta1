import { getAuthenticatedUser, pilotAuthenticationConfigured } from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  const pilotAvailable = pilotAuthenticationConfigured();
  if (!user) return Response.json({ authenticated: false, pilotAvailable }, { status: 401 });
  return Response.json({ authenticated: true, user, pilotAvailable });
}
