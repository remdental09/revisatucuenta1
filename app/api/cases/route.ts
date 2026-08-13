import { env } from "cloudflare:workers";

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, patient_name TEXT NOT NULL, episode_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'collecting', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, original_name TEXT NOT NULL, storage_key TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, classification TEXT NOT NULL, classification_confidence INTEGER NOT NULL, page_from INTEGER, page_to INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(case_id) REFERENCES cases(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS extracted_fields (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, field_key TEXT NOT NULL, field_value TEXT NOT NULL, source_page INTEGER NOT NULL, source_region TEXT, confidence INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(document_id) REFERENCES documents(id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_extracted_fields_document_id ON extracted_fields(document_id)`),
  ]);
}

export async function POST(request: Request) {
  const body = await request.json() as { id?: string; patientName?: string; episodeLabel?: string };
  if (!body.id || !body.episodeLabel) return Response.json({ error: "Datos incompletos" }, { status: 400 });
  await ensureSchema(env.DB);
  await env.DB.prepare(`INSERT OR REPLACE INTO cases (id, patient_name, episode_label, status, updated_at) VALUES (?, ?, ?, 'collecting', CURRENT_TIMESTAMP)`)
    .bind(body.id, body.patientName || "Paciente", body.episodeLabel).run();
  return Response.json({ caseId: body.id }, { status: 201 });
}
