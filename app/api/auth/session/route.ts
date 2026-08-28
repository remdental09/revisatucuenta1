import { getAuthenticatedUser } from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({ authenticated: true, user });
}
