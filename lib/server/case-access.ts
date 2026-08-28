import type { AuthenticatedUser } from "./auth.ts";
import { isDeveloperUser } from "./auth.ts";
import { ensureCaseSchema } from "./case-schema.ts";
import { localCanAccessCase, localDocumentCaseId } from "./runtime-store.ts";

export async function caseAccessResponse(env: any, caseId: string, user: AuthenticatedUser) {
  const developer = isDeveloperUser(user);
  if (!env?.DB) {
    return localCanAccessCase(caseId, user.id, developer)
      ? undefined
      : Response.json({ error: "Caso no encontrado" }, { status: 404 });
  }
  await ensureCaseSchema(env.DB);
  const row = await env.DB.prepare(`SELECT owner_user_id FROM cases WHERE id = ?`).bind(caseId).first();
  if (!row || (!developer && String(row.owner_user_id || "") !== user.id)) {
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
