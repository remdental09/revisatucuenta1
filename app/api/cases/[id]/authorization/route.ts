import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localAuthorize, localGetCase } from "../../../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../../lib/server/case-access.ts";

const DEFAULT_SCOPE = "Preparar y presentar solicitudes de aclaración y reclamos ante el prestador de salud; sin aceptar acuerdos ni recibir fondos en nombre del paciente.";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as { scope?: string };
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;
  if (!env?.DB) {
    if (!localGetCase(id, auth.user.id, true)) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    const scope = body.scope || DEFAULT_SCOPE;
    const at = new Date().toISOString();
    localAuthorize(id, scope, at);
    return Response.json({ authorized: true, scope, at });
  }
  await ensureCaseSchema(env.DB);
  const exists = await env.DB.prepare(`SELECT id FROM cases WHERE id = ?`).bind(id).first();
  if (!exists) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  const scope = body.scope || DEFAULT_SCOPE;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO claim_authorizations (id, case_id, authorized, scope, authorized_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(case_id) DO UPDATE SET authorized = 1, scope = excluded.scope, authorized_at = excluded.authorized_at`)
    .bind(crypto.randomUUID(), id, scope, now).run();
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), id, "Autorización registrada", "El paciente autorizó preparar solicitudes de aclaración y reclamos.").run();
  return Response.json({ authorized: true, scope, at: now });
}
