import type { AuthenticatedUser } from "./auth.ts";
import { isDeveloperUser } from "./auth.ts";
import { ensureCaseSchema } from "./case-schema.ts";
import { localCanAccessCase, localCaseRetentionMode, localDocumentCaseId } from "./runtime-store.ts";
import { cleanupExpiredEphemeralCases } from "./source-retention.ts";

export async function caseAccessResponse(env: any, caseId: string, user: AuthenticatedUser) {
  const developer = isDeveloperUser(user);
  // Enforce the commercial retention window on every case access, not only
  // when the case list is opened. This closes stale direct-link access.
  await cleanupExpiredEphemeralCases(env);
  if (!env?.DB) {
    return localCanAccessCase(caseId, user.id, developer) && (developer || localCaseRetentionMode(caseId) === "ephemeral")
      ? undefined
      : Response.json({ error: "Caso no encontrado" }, { status: 404 });
  }
  await ensureCaseSchema(env.DB);
  const row = await env.DB.prepare(`SELECT owner_user_id, retention_mode FROM cases WHERE id = ?`).bind(caseId).first();
  if (!row || (!developer && (String(row.owner_user_id || "") !== user.id || String(row.retention_mode || "persistent") !== "ephemeral"))) {
    return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  }
}

export function developerAccessResponse(user: AuthenticatedUser) {
  return isDeveloperUser(user)
    ? undefined
    : Response.json({ error: "Esta operación requiere acceso del equipo revisor" }, { status: 403 });
}

export async function documentAccess(
  env: any,
  documentId: string,
  user: AuthenticatedUser,
): Promise<{ caseId: string } | { response: Response }> {
  let caseId: string | undefined;
  if (!env?.DB) {
    caseId = localDocumentCaseId(documentId);
  } else {
    await ensureCaseSchema(env.DB);
    const row = await env.DB.prepare(`SELECT case_id FROM documents WHERE id = ?`).bind(documentId).first();
    caseId = row?.case_id ? String(row.case_id) : undefined;
  }
  if (!caseId) return { response: Response.json({ error: "Documento no encontrado" }, { status: 404 }) };
  const denied = await caseAccessResponse(env, caseId, user);
  return denied ? { response: denied } : { caseId };
}
