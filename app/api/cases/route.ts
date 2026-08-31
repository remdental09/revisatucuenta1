import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localCreateCase, localListCases } from "../../../lib/server/runtime-store.ts";
import { isDeveloperUser, requireApiUser } from "../../../lib/server/auth.ts";
import { purgeExpiredDocumentSources } from "../../../lib/server/source-retention.ts";
import { resetPilotData } from "../../../lib/server/pilot-reset.ts";
import { isValidChileanRun, normalizeChileanRun } from "../../../lib/identity/chilean-run.ts";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const developer = isDeveloperUser(auth.user);
  const env = await getCloudflareEnv();
  await purgeExpiredDocumentSources(env);
  if (developer) await resetPilotData(env);
  if (!env?.DB) return Response.json({ cases: localListCases(auth.user.id, developer) });
  await ensureCaseSchema(env.DB);
  const query = developer
    ? `SELECT c.id, c.patient_name, c.patient_run, c.episode_label, c.status, c.created_at, c.updated_at,
      COUNT(d.id) AS document_count
     FROM cases c
     LEFT JOIN documents d ON d.case_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.created_at DESC`
    : `SELECT c.id, c.patient_name, c.patient_run, c.episode_label, c.status, c.created_at, c.updated_at,
      COUNT(d.id) AS document_count
     FROM cases c
     LEFT JOIN documents d ON d.case_id = c.id
     WHERE c.owner_user_id = ?
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.created_at DESC`;
  const statement = env.DB.prepare(query);
  const result = developer ? await statement.all() : await statement.bind(auth.user.id).all();
  return Response.json({ cases: result.results });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { id?: string; patientName?: string; patientRun?: string; contactEmail?: string; episodeLabel?: string; requireContact?: boolean; requirePatientIdentity?: boolean };
  if (!body.id || !body.episodeLabel) return Response.json({ error: "Datos incompletos" }, { status: 400 });
  const patientName = body.patientName?.trim() || "Paciente";
  const patientRun = body.patientRun ? normalizeChileanRun(body.patientRun) : "";
  if (body.requirePatientIdentity && (patientName === "Paciente" || !patientRun)) return Response.json({ error: "Ingresa tu nombre completo y RUN para continuar" }, { status: 400 });
  if (patientRun && !isValidChileanRun(patientRun)) return Response.json({ error: "Revisa el RUN ingresado. Usa el formato 12.345.678-9." }, { status: 400 });
  const contactEmail = auth.user.email;
  const env = await getCloudflareEnv();
  if (!env?.DB) {
    const created = localCreateCase({ id: body.id, ownerUserId: auth.user.id, ownerEmail: auth.user.email, patientName, patientRun, contactEmail, episodeLabel: body.episodeLabel });
    if (!created) return Response.json({ error: "El identificador del expediente ya existe" }, { status: 409 });
    return Response.json({ caseId: body.id }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  const existing = await env.DB.prepare(`SELECT id FROM cases WHERE id = ?`).bind(body.id).first();
  if (existing) return Response.json({ error: "El identificador del expediente ya existe" }, { status: 409 });
  await env.DB.prepare(`INSERT INTO cases (id, owner_user_id, owner_email, patient_name, patient_run, contact_email, episode_label, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'collecting', CURRENT_TIMESTAMP)`)
    .bind(body.id, auth.user.id, auth.user.email, patientName, patientRun, contactEmail, body.episodeLabel).run();
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), body.id, "Caso creado", "Se abrió el expediente para revisión.").run();
  return Response.json({ caseId: body.id }, { status: 201 });
}
