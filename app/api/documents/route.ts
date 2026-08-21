import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetDocuments, localSaveDocument } from "../../../lib/server/runtime-store.ts";

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId");
  if (!caseId) return Response.json({ error: "Caso ausente" }, { status: 400 });
  const env = await getCloudflareEnv();
  if (!env?.DB) return Response.json({ documents: localGetDocuments(caseId) });
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(`SELECT id, original_name, mime_type, byte_size, classification, classification_confidence, page_from, page_to, created_at FROM documents WHERE case_id = ? ORDER BY created_at ASC`).bind(caseId).all();
  return Response.json({ documents: result.results });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const caseId = String(form.get("caseId") || "");
  const documentId = String(form.get("documentId") || crypto.randomUUID());
  if (!(file instanceof File) || !caseId) return Response.json({ error: "Archivo o caso ausente" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "El archivo supera el límite de 25 MB" }, { status: 413 });
  const key = `cases/${caseId}/${documentId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const env = await getCloudflareEnv();
  if (!env?.DB || !env?.DOCUMENTS) {
    localSaveDocument({ id: documentId, caseId, name: file.name, mimeType: file.type || "application/octet-stream", byteSize: file.size, classification: String(form.get("classification") || "Por confirmar"), confidence: Number(form.get("confidence") || 0) });
    return Response.json({ documentId, storageKey: key, local: true }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  await env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { caseId, documentId, originalName: file.name } });
  await env.DB.prepare(`INSERT OR REPLACE INTO documents (id, case_id, original_name, storage_key, mime_type, byte_size, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(documentId, caseId, file.name, key, file.type || "application/octet-stream", file.size, String(form.get("classification") || "Por confirmar"), Number(form.get("confidence") || 0)).run();
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
