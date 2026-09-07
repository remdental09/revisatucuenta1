import { getCloudflareEnv } from "../../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../../lib/server/auth.ts";
import { developerAccessResponse } from "../../../../lib/server/case-access.ts";
import { resetPilotData } from "../../../../lib/server/pilot-reset.ts";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const denied = developerAccessResponse(auth.user);
  if (denied) return denied;
  const result = await resetPilotData(await getCloudflareEnv());
  return Response.json({ ...result, memoryless: true, message: "Se eliminaron los datos persistidos de las cuentas y sus observaciones." }, { headers: { "cache-control": "no-store" } });
}
