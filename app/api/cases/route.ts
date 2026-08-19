import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localCreateCase, localListCases } from "../../../lib/server/runtime-store.ts";

export async function GET() {
  const env = await getCloudflareEnv();
  if (!env?.DB) return Response.json({ cases: localListCases() });
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(
    `SELECT c.id, c.patient_name, c.episode_label, c.status, c.created_at, c.updated_at,
      COUNT(d.id) AS document_count
     FROM cases c
     LEFT JOIN documents d ON d.case_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.created_at DESC`,
  ).all();
  return Response.json({ cases: result.results });
}

export async function POST(request: Request) {
  const body = await request.json() as { id?: string; patientName?: string; episodeLabel?: string };
  if (!body.id || !body.episodeLabel) return Response.json({ error: "Datos incompletos" }, { status: 400 });
  const env = await getCloudflareEnv();
  if (!env?.DB) {
    localCreateCase({ id: body.id, patientName: body.patientName, episodeLabel: body.episodeLabel });
    return Response.json({ caseId: body.id }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  await env.DB.prepare(`INSERT OR REPLACE INTO cases (id, patient_name, episode_label, status, updated_at) VALUES (?, ?, ?, 'collecting', CURRENT_TIMESTAMP)`)
    .bind(body.id, body.patientName || "Paciente", body.episodeLabel).run();
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), body.id, "Caso creado", "Se abrió el expediente para revisión.").run();
  return Response.json({ caseId: body.id }, { status: 201 });
}
