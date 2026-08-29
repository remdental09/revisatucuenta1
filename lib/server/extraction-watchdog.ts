const STALE_EXTRACTION_MINUTES = 120;
const STALE_EXTRACTION_MESSAGE = "La lectura no informó avances dentro del tiempo esperado. Reemplaza el documento para reintentar o prepara una revisión humana/LLM.";

type Database = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      all: () => Promise<{ results: Array<Record<string, unknown>> }>;
      run: () => Promise<{ meta?: { changes?: number } }>;
    };
  };
};

export async function recoverStaleDatabaseExtractions(db: Database | null | undefined, caseId?: string) {
  if (!db) return 0;
  const filter = caseId ? " AND case_id = ?" : "";
  const bindings = caseId ? [caseId] : [];
  const result = await db.prepare(
    `SELECT id, case_id, original_name FROM documents WHERE processing_status = 'extracting' AND created_at < datetime('now', '-${STALE_EXTRACTION_MINUTES} minutes')${filter}`,
  ).bind(...bindings).all();
  let recovered = 0;
  for (const row of result.results) {
    const update = await db.prepare(
      `UPDATE documents SET processing_status = 'failed', processing_error = ? WHERE id = ? AND processing_status = 'extracting'`,
    ).bind(STALE_EXTRACTION_MESSAGE, String(row.id)).run();
    if (!Number(update.meta?.changes || 0)) continue;
    recovered += 1;
    const id = String(row.case_id);
    await db.prepare(`UPDATE cases SET status = 'human_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
    await db.prepare(`INSERT INTO case_activities (id, case_id, title, detail, pending) VALUES (?, ?, ?, ?, 1)`)
      .bind(crypto.randomUUID(), id, "Revisión humana requerida", `${String(row.original_name || "El documento")} no informó avances y necesita reintento o revisión externa.`).run();
  }
  return recovered;
}

export { STALE_EXTRACTION_MESSAGE };
