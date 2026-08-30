import { developerAccessResponse } from "../../../../lib/server/case-access.ts";
import { requireApiUser } from "../../../../lib/server/auth.ts";
import { getCloudflareEnv } from "../../../../lib/server/runtime-store.ts";
import { PILOT_RESET_VERSION, resetPilotData } from "../../../../lib/server/pilot-reset.ts";

// This is a one-time migration for the pilot deployment. It clears old case
// records while preserving validated corpus observations for the rule engine.
// Change the version only when an explicitly authorized pilot reset is needed.
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const denied = developerAccessResponse(auth.user);
  if (denied) return denied;

  const body = await request.json().catch(() => ({})) as { version?: unknown };
  if (body.version !== PILOT_RESET_VERSION) {
    return Response.json({ error: "Versión de limpieza no autorizada" }, { status: 422 });
  }

  const env = await getCloudflareEnv();
  return Response.json(await resetPilotData(env), { headers: { "cache-control": "no-store" } });
}
