import { ensureCaseSchema } from "./case-schema.ts";
import { localCleanupEphemeralCases, localPurgeCase } from "./runtime-store.ts";

// Commercial patient sessions are deliberately short-lived. A successful
// analysis purges them immediately; this window is the safety net for an
// abandoned tab or a failed upload.
export const EPHEMERAL_CASE_TTL_MS = 2 * 60 * 60 * 1000;

export function ephemeralDocumentExpiry() {
  return new Date(Date.now() + EPHEMERAL_CASE_TTL_MS).toISOString();
}

export function patientForwardingEnabled(env: any) {
  const value = env?.REVISATUCUENTA_PATIENT_FORWARD
    ?? (typeof process !== "undefined" ? process.env.REVISATUCUENTA_PATIENT_FORWARD : undefined);
  return String(value || "").trim().toLowerCase() === "true";
}

/** Permanently removes a case and all of its derived clinical data. */
export async function purgeCaseData(env: any, caseId: string, ownerUserId?: string) {
  if (!env?.DB) return localPurgeCase(caseId, ownerUserId || "", !ownerUserId);
  await ensureCaseSchema(env.DB);
  const documents = await env.DB.prepare(`SELECT storage_key FROM documents WHERE case_id = ?`).bind(caseId).all();
  if (env.DOCUMENTS) {
    await Promise.all((documents.results as Array<Record<string, unknown>>).map(async (document) => {
      if (document.storage_key) await env.DOCUMENTS.delete(String(document.storage_key)).catch(() => undefined);
    }));
  }
  const result = await env.DB.batch([
    env.DB.prepare(`DELETE FROM extracted_fields WHERE document_id IN (SELECT id FROM documents WHERE case_id = ?)`).bind(caseId),
    env.DB.prepare(`DELETE FROM document_extractions WHERE document_id IN (SELECT id FROM documents WHERE case_id = ?)`).bind(caseId),
    env.DB.prepare(`DELETE FROM case_analyses WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM claim_authorizations WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM service_contracts WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM case_activities WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM documents WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM corpus_contributions WHERE case_id = ?`).bind(caseId),
    env.DB.prepare(`DELETE FROM cases WHERE id = ?`).bind(caseId),
  ]);
  const deletedCases = Number((result?.[8] as any)?.meta?.changes || 0);
  return { caseId, deletedCases, deletedDocuments: documents.results.length };
}

export async function cleanupExpiredEphemeralCases(env: any) {
  if (!env?.DB) return localCleanupEphemeralCases(EPHEMERAL_CASE_TTL_MS);
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(
    `SELECT id FROM cases WHERE retention_mode = 'ephemeral' AND updated_at <= datetime('now', '-2 hours')`,
  ).all();
  let deletedCases = 0;
  let deletedDocuments = 0;
  for (const row of result.results as Array<Record<string, unknown>>) {
    const purged = await purgeCaseData(env, String(row.id));
    if (purged) {
      deletedCases += purged.deletedCases;
      deletedDocuments += purged.deletedDocuments;
    }
  }
  return { deletedCases, deletedDocuments };
}

export async function preserveDocumentSources(env: any) {
  const result = await cleanupExpiredEphemeralCases(env);
  return result.deletedDocuments;
}
