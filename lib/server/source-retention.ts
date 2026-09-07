import { ensureCaseSchema } from "./case-schema.ts";

export async function preserveDocumentSources(env: any) {
  if (!env?.DB) return 0;
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(
    `UPDATE documents SET source_expires_at = NULL
     WHERE source_deleted_at IS NULL AND source_expires_at IS NOT NULL`,
  ).run();
  return Number(result.meta?.changes || 0);
}
