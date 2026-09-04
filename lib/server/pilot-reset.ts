import { ensureCaseSchema } from "./case-schema.ts";
import { localResetPilot, volatileRuntimeMode } from "./runtime-store.ts";

export const PILOT_RESET_VERSION = "2026-08-30-empty-console-v2";
const PILOT_RESET_FLAG = "pilot_reset_version";

/**
 * One-time cleanup for the pilot deployment. Case records and their temporary
 * source files are removed, while validated corpus observations remain intact.
 */
export async function resetPilotData(env: any) {
  if (!env?.DB) {
    // Volatile mode is used for isolated training runs. Keep its in-memory
    // cases available while the operator switches between developer/patient
    // views; production keeps the one-time pilot cleanup behavior.
    if (await volatileRuntimeMode()) return { reset: false, deletedCases: 0, deletedDocuments: 0 };
    return localResetPilot(PILOT_RESET_VERSION);
  }

  await ensureCaseSchema(env.DB);
  const flag = await env.DB.prepare(`SELECT flag_value FROM runtime_flags WHERE flag_key = ?`).bind(PILOT_RESET_FLAG).first();
  if (String(flag?.flag_value || "") === PILOT_RESET_VERSION) {
    return { reset: false, deletedCases: 0, deletedDocuments: 0 };
  }

  const documents = await env.DB.prepare(`SELECT storage_key FROM documents`).all();
  if (env.DOCUMENTS) {
    await Promise.all((documents.results as Array<Record<string, unknown>>).map(async (document) => {
      if (document.storage_key) await env.DOCUMENTS.delete(String(document.storage_key)).catch(() => undefined);
    }));
  }
  const cases = await env.DB.prepare(`SELECT COUNT(*) AS count FROM cases`).first();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM extracted_fields`),
    env.DB.prepare(`DELETE FROM document_extractions`),
    env.DB.prepare(`DELETE FROM case_analyses`),
    env.DB.prepare(`DELETE FROM claim_authorizations`),
    env.DB.prepare(`DELETE FROM service_contracts`),
    env.DB.prepare(`DELETE FROM case_activities`),
    env.DB.prepare(`DELETE FROM documents`),
    env.DB.prepare(`DELETE FROM cases`),
    env.DB.prepare(`DELETE FROM corpus_contributions WHERE status <> 'validated'`),
    env.DB.prepare(`INSERT OR REPLACE INTO runtime_flags (flag_key, flag_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).bind(PILOT_RESET_FLAG, PILOT_RESET_VERSION),
  ]);
  return { reset: true, deletedCases: Number(cases?.count || 0), deletedDocuments: documents.results.length };
}
