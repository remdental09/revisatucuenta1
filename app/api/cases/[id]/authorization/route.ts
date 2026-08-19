import { env } from "cloudflare:workers";
import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";

const DEFAULT_SCOPE = "Preparar y presentar solicitudes de aclaración y reclamos ante el prestador de salud; sin aceptar acuerdos ni recibir fondos en nombre del paciente.";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await ensureCaseSchema(env.DB);
  const body = await request.json().catch(() => ({})) as { scope?: string };
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
