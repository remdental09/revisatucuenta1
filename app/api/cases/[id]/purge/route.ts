import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetCase, localPurgeCase } from "../../../../../lib/server/runtime-store.ts";
import { isDeveloperUser, requireApiUser } from "../../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../../lib/server/case-access.ts";
import { purgeCaseData } from "../../../../../lib/server/source-retention.ts";

/**
 * Ends a commercial patient session. This endpoint is intentionally not
 * available to the developer console, whose PAM and contract workspace is
 * durable by design.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  if (isDeveloperUser(auth.user)) {
    return Response.json({ error: "La purga de sesión sólo aplica a casos comerciales" }, { status: 403 });
  }
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;

  if (!env?.DB) {
    const snapshot = localGetCase(id, auth.user.id);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    const purged = localPurgeCase(id, auth.user.id);
    return purged
      ? Response.json({ purged: true, deletedDocuments: purged.deletedDocuments }, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "No se pudo cerrar la sesión" }, { status: 409 });
  }

  await ensureCaseSchema(env.DB);
  const row = await env.DB.prepare(`SELECT retention_mode FROM cases WHERE id = ? AND owner_user_id = ?`).bind(id, auth.user.id).first();
  if (!row) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  if (String(row.retention_mode || "persistent") !== "ephemeral") {
    return Response.json({ error: "El caso no corresponde a una sesión comercial" }, { status: 409 });
  }
  const purged = await purgeCaseData(env, id);
  return Response.json({ purged: true, deletedDocuments: purged?.deletedDocuments || 0 }, { headers: { "cache-control": "no-store" } });
}
