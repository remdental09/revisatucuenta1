import { ensureCaseSchema } from "../../../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetServiceContract, localUpdateServiceContractPayment } from "../../../../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../../../lib/server/case-access.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as { demo?: boolean };
  if (body.demo !== true) return Response.json({ error: "Este enlace sólo admite el pago de demostración." }, { status: 400 });
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;

  if (!env?.DB) {
    const contract = localGetServiceContract(id, auth.user.id, true);
    if (!contract) return Response.json({ error: "Contrato no encontrado" }, { status: 404 });
    return Response.json({ paid: Boolean(localUpdateServiceContractPayment(id, "paid_demo")) });
  }

  await ensureCaseSchema(env.DB);
  const contract = await env.DB.prepare(`SELECT id FROM service_contracts WHERE case_id = ?`).bind(id).first();
  if (!contract) return Response.json({ error: "Contrato no encontrado" }, { status: 404 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE service_contracts SET status = 'paid_demo', payment_status = 'paid_demo', updated_at = ? WHERE case_id = ?`).bind(now, id),
    env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail, event_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, "Pago de demostración registrado", "El piloto registró un pago simulado; no se realizó ningún cobro real.", now),
  ]);
  return Response.json({ paid: true });
}
