import { ensureCaseSchema } from "./case-schema.ts";

export async function purgeExpiredDocumentSources(env: any) {
  if (!env?.DB || !env?.DOCUMENTS) return 0;
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(
    `SELECT id, storage_key FROM documents
     WHERE source_deleted_at IS NULL
       AND source_expires_at IS NOT NULL
       AND source_expires_at <= CURRENT_TIMESTAMP
     ORDER BY source_expires_at ASC
     LIMIT 50`,
  ).all();
  let deleted = 0;
  for (const row of result.results as Array<Record<string, unknown>>) {
    try {
      await env.DOCUMENTS.delete(String(row.storage_key));
      await env.DB.prepare(`UPDATE documents SET source_deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(String(row.id)).run();
      deleted += 1;
    } catch {
      // A later request retries cleanup without losing the extraction record.
    }
  }
  return deleted;
}

