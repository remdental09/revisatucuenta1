import { ensureCaseSchema } from "../../../../lib/server/case-schema.ts";
import { developerAccessResponse } from "../../../../lib/server/case-access.ts";
import { requireApiUser } from "../../../../lib/server/auth.ts";
import { getCloudflareEnv, localResetPilot } from "../../../../lib/server/runtime-store.ts";

// This is a one-time migration for the pilot deployment. It clears old case
// records while preserving validated corpus observations for the rule engine.
// Change the version only when an explicitly authorized pilot reset is needed.
const PILOT_RESET_VERSION = "2026-08-30-empty-console-v1";
const PILOT_RESET_FLAG = "pilot_reset_version";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const denied = developerAccessResponse(auth.user);
  if (denied) return denied;

  const body = await request.json().catch(() => ({})) as { version?: unknown };
  if (body.version !== PILOT_RESET_VERSION) {
    return Response.json({ error: "Versión de limpieza no autorizada" }, { status: 422 });
  }

  const env = await getCloudflareEnv();
  if (!env?.DB) return Response.json(localResetPilot(PILOT_RESET_VERSION), { headers: { "cache-control": "no-store" } });

  await ensureCaseSchema(env.DB);
  const flag = await env.DB.prepare(`SELECT flag_value FROM runtime_flags WHERE flag_key = ?`).bind(PILOT_RESET_FLAG).first();
  if (String(flag?.flag_value || "") === PILOT_RESET_VERSION) {
    return Response.json({ reset: false, deletedCases: 0, deletedDocuments: 0 }, { headers: { "cache-control": "no-store" } });
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
    env.DB.prepare(`DELETE FROM case_activities`),
    env.DB.prepare(`DELETE FROM documents`),
    env.DB.prepare(`DELETE FROM cases`),
    env.DB.prepare(`DELETE FROM corpus_contributions WHERE status <> 'validated'`),
    env.DB.prepare(`INSERT OR REPLACE INTO runtime_flags (flag_key, flag_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).bind(PILOT_RESET_FLAG, PILOT_RESET_VERSION),
  ]);
  return Response.json({ reset: true, deletedCases: Number(cases?.count || 0), deletedDocuments: documents.results.length }, { headers: { "cache-control": "no-store" } });
}
