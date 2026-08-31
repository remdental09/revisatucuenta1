import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetCase, localRequestAdvisory } from "../../../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../../lib/server/case-access.ts";

const ADVISORY_ACTIVITY_TITLE = "Solicitud de asesoría recibida";
const ADVISORY_ACTIVITY_DETAIL = "El paciente solicitó información sobre una asesoría para revisar posibles inconsistencias. No implica autorización para reclamos ni aceptación de acuerdos.";

type AdvisoryRequest = { contactConsent?: boolean };
type PaymentEnvironment = { PATIENT_ADVISORY_PAYMENT_URL?: unknown };

function configuredPaymentLink(env: PaymentEnvironment | null | undefined) {
  const value = env?.PATIENT_ADVISORY_PAYMENT_URL
    || (typeof process !== "undefined" ? process.env.PATIENT_ADVISORY_PAYMENT_URL?.trim() : undefined);
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: AdvisoryRequest;
  try {
    body = (await request.json()) as AdvisoryRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON inválida" }, { status: 400 });
  }
  if (body.contactConsent !== true) {
    return Response.json({ error: "Debes aceptar el contacto para solicitar la asesoría" }, { status: 400 });
  }

  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;

  if (!env?.DB) {
    const snapshot = localGetCase(id, auth.user.id, true);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    if (!snapshot.analysis) return Response.json({ error: "El resultado todavía no está disponible" }, { status: 409 });
    return Response.json({ ...localRequestAdvisory(id), paymentUrl: configuredPaymentLink(env) });
  }

  await ensureCaseSchema(env.DB);
  const analysis = await env.DB.prepare(`SELECT id FROM case_analyses WHERE case_id = ?`).bind(id).first();
  if (!analysis) return Response.json({ error: "El resultado todavía no está disponible" }, { status: 409 });

  const existing = await env.DB.prepare(`SELECT id, event_at FROM case_activities WHERE case_id = ? AND title = ? ORDER BY event_at ASC LIMIT 1`)
    .bind(id, ADVISORY_ACTIVITY_TITLE).first();
  if (existing) {
    return Response.json({ requested: true, alreadyRequested: true, at: String(existing.event_at), paymentUrl: configuredPaymentLink(env) });
  }

  const at = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail, event_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), id, ADVISORY_ACTIVITY_TITLE, ADVISORY_ACTIVITY_DETAIL, at).run();
  return Response.json({ requested: true, alreadyRequested: false, at, paymentUrl: configuredPaymentLink(env) });
}
