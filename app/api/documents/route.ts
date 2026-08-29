import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localDeleteDocument, localGetDocuments, localSaveDocument, localUpdateDocumentProcessing } from "../../../lib/server/runtime-store.ts";
import { removePendingCorpusContribution } from "../../../lib/server/observed-corpus-store.ts";
import { requireApiUser } from "../../../lib/server/auth.ts";
import { caseAccessResponse, developerAccessResponse } from "../../../lib/server/case-access.ts";
import { purgeExpiredDocumentSources } from "../../../lib/server/source-retention.ts";
import { recoverStaleDatabaseExtractions } from "../../../lib/server/extraction-watchdog.ts";

function sourceKindForClassification(classification: string): "account" | "pam" | undefined {
  if (/pam|liquid/i.test(classification)) return "pam";
  if (/cuenta|mixto/i.test(classification)) return "account";
  return undefined;
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId");
  if (!caseId) return Response.json({ error: "Caso ausente" }, { status: 400 });
  const env = await getCloudflareEnv();
  await purgeExpiredDocumentSources(env);
  const denied = await caseAccessResponse(env, caseId, auth.user);
  if (denied) return denied;
  if (url.searchParams.get("download") === "source") {
    const developerDenied = developerAccessResponse(auth.user);
    if (developerDenied) return developerDenied;
    const documentId = url.searchParams.get("documentId") || "";
    if (!documentId || !env?.DB || !env?.DOCUMENTS) return Response.json({ error: "El documento original ya no está disponible" }, { status: 410 });
    await ensureCaseSchema(env.DB);
    const row = await env.DB.prepare(`SELECT original_name, storage_key, mime_type, source_deleted_at FROM documents WHERE id = ? AND case_id = ?`).bind(documentId, caseId).first();
    if (!row || row.source_deleted_at) return Response.json({ error: "El documento original ya no está disponible" }, { status: 410 });
    const source = await env.DOCUMENTS.get(String(row.storage_key));
    if (!source) return Response.json({ error: "El documento original ya no está disponible" }, { status: 410 });
    const bytes = await source.arrayBuffer();
    const safeName = String(row.original_name).replace(/[\r\n"\\]/g, "_");
    return new Response(bytes, { headers: { "content-type": String(row.mime_type || "application/octet-stream"), "content-disposition": `attachment; filename="${safeName}"`, "cache-control": "private, no-store" } });
  }
  if (!env?.DB) return Response.json({ documents: localGetDocuments(caseId, auth.user.id, true) });
  await ensureCaseSchema(env.DB);
  await recoverStaleDatabaseExtractions(env.DB, caseId);
  const result = await env.DB.prepare(`SELECT id, original_name, mime_type, byte_size, classification, classification_confidence, processing_status, processing_error, source_expires_at, source_deleted_at, page_from, page_to, created_at FROM documents WHERE case_id = ? ORDER BY created_at ASC`).bind(caseId).all();
  return Response.json({ documents: result.results });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const file = form.get("file");
  const caseId = String(form.get("caseId") || "");
  const documentId = String(form.get("documentId") || crypto.randomUUID());
  if (!(file instanceof File) || !caseId) return Response.json({ error: "Archivo o caso ausente" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "El archivo supera el límite de 25 MB" }, { status: 413 });
  const key = `cases/${caseId}/${documentId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, caseId, auth.user);
  if (denied) return denied;
  if (!env?.DB || !env?.DOCUMENTS) {
    localSaveDocument({ id: documentId, caseId, name: file.name, mimeType: file.type || "application/octet-stream", byteSize: file.size, classification: String(form.get("classification") || "Por confirmar"), confidence: Number(form.get("confidence") || 0) });
    return Response.json({ documentId, storageKey: key, local: true }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  await env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { caseId, documentId, originalName: file.name } });
  await env.DB.prepare(`INSERT OR REPLACE INTO documents (id, case_id, original_name, storage_key, mime_type, byte_size, classification, classification_confidence, processing_status, source_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'extracting', ?)`)
    .bind(documentId, caseId, file.name, key, file.type || "application/octet-stream", file.size, String(form.get("classification") || "Por confirmar"), Number(form.get("confidence") || 0), expiresAt).run();
  if (/cuenta|mixto/i.test(String(form.get("classification") || ""))) {
    await env.DB.prepare(`DELETE FROM case_analyses WHERE case_id = ?`).bind(caseId).run();
  }
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), caseId, "Documento incorporado", `${file.name} quedó disponible para revisión.`).run();
  const currentCase = await env.DB.prepare(`SELECT status FROM cases WHERE id = ?`).bind(caseId).first();
  if (String(currentCase?.status || "") === "collecting") {
    await env.DB.prepare(`UPDATE cases SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(caseId).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), caseId, "Revisión iniciada", "El expediente quedó en cola para revisión interna.").run();
  }
  return Response.json({ documentId, storageKey: key }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as { caseId?: string; documentId?: string; status?: string; error?: string };
  if (!body.caseId || !body.documentId || !body.status) return Response.json({ error: "Estado de documento incompleto" }, { status: 400 });
  if (!["extracting", "failed", "review_required"].includes(body.status)) return Response.json({ error: "Estado de documento inválido" }, { status: 422 });
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, body.caseId, auth.user);
  if (denied) return denied;
  const error = body.error?.slice(0, 500) || undefined;
  if (!env?.DB) {
    if (!localUpdateDocumentProcessing(body.documentId, body.status, error)) return Response.json({ error: "Documento no encontrado" }, { status: 404 });
    return Response.json({ updated: true });
  }
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(`UPDATE documents SET processing_status = ?, processing_error = ? WHERE id = ? AND case_id = ?`)
    .bind(body.status, error || null, body.documentId, body.caseId).run();
  if (!Number(result.meta?.changes || 0)) return Response.json({ error: "Documento no encontrado" }, { status: 404 });
  if (["failed", "review_required"].includes(body.status)) {
    await env.DB.prepare(`UPDATE cases SET status = 'human_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.caseId).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail, pending) VALUES (?, ?, ?, ?, 1)`)
      .bind(crypto.randomUUID(), body.caseId, "Revisión humana requerida", error || "El formato necesita validación antes de emitir un resultado.").run();
  }
  return Response.json({ updated: true });
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const caseId = params.get("caseId") || "";
  const documentId = params.get("documentId") || "";
  if (!caseId || !documentId) return Response.json({ error: "Caso o documento ausente" }, { status: 400 });

  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, caseId, auth.user);
  if (denied) return denied;
  if (!env?.DB) {
    const deleted = localDeleteDocument(documentId, caseId);
    if (!deleted) return Response.json({ error: "Documento no encontrado" }, { status: 404 });
    await removePendingCorpusContribution(env, caseId, sourceKindForClassification(deleted.classification));
    return Response.json({ documentId, deleted: true, name: deleted.name });
  }

  await ensureCaseSchema(env.DB);
  const document = await env.DB.prepare(
    `SELECT id, original_name, storage_key, classification FROM documents WHERE id = ? AND case_id = ?`,
  ).bind(documentId, caseId).first() as { id?: string; original_name?: string; storage_key?: string; classification?: string } | null;
  if (!document) return Response.json({ error: "Documento no encontrado" }, { status: 404 });

  await env.DB.prepare(`DELETE FROM extracted_fields WHERE document_id = ?`).bind(documentId).run();
  await env.DB.prepare(`DELETE FROM document_extractions WHERE document_id = ?`).bind(documentId).run();
  if (/cuenta|mixto/i.test(String(document.classification || ""))) {
    await env.DB.prepare(`DELETE FROM case_analyses WHERE case_id = ?`).bind(caseId).run();
  }
  await env.DB.prepare(`DELETE FROM documents WHERE id = ? AND case_id = ?`).bind(documentId, caseId).run();

  if (env.DOCUMENTS && document.storage_key) {
    try { await env.DOCUMENTS.delete(String(document.storage_key)); } catch { /* The database record is the source of truth for the UI. */ }
  }

  await removePendingCorpusContribution(env, caseId, sourceKindForClassification(String(document.classification || "")));

  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM documents WHERE case_id = ?`).bind(caseId).first();
  const nextStatus = Number(remaining?.count || 0) > 0 ? "under_review" : "collecting";
  await env.DB.prepare(`UPDATE cases SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(nextStatus, caseId).run();
  await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), caseId, "Documento eliminado", `${String(document.original_name || "El documento")} fue retirado del expediente.`).run();

  return Response.json({ documentId, deleted: true, name: String(document.original_name || "") });
}
