export async function ensureCaseSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, patient_name TEXT NOT NULL, episode_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'collecting', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, original_name TEXT NOT NULL, storage_key TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, classification TEXT NOT NULL, classification_confidence INTEGER NOT NULL, page_from INTEGER, page_to INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(case_id) REFERENCES cases(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS extracted_fields (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, field_key TEXT NOT NULL, field_value TEXT NOT NULL, source_page INTEGER NOT NULL, source_region TEXT, confidence INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(document_id) REFERENCES documents(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS document_extractions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE, extraction_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(document_id) REFERENCES documents(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS case_analyses (id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE, analysis_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(case_id) REFERENCES cases(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claim_authorizations (id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE, authorized INTEGER NOT NULL DEFAULT 0, scope TEXT NOT NULL, authorized_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(case_id) REFERENCES cases(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS case_activities (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, pending INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(case_id) REFERENCES cases(id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_extracted_fields_document_id ON extracted_fields(document_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_case_activities_case_id ON case_activities(case_id, event_at)`),
  ]);
}

export function jsonOrNull<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
