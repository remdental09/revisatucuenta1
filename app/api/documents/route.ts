import { env } from "cloudflare:workers";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const caseId = String(form.get("caseId") || "");
  const documentId = String(form.get("documentId") || crypto.randomUUID());
  if (!(file instanceof File) || !caseId) return Response.json({ error: "Archivo o caso ausente" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "El archivo supera el límite de 25 MB" }, { status: 413 });
  const key = `cases/${caseId}/${documentId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { caseId, documentId, originalName: file.name } });
  await env.DB.prepare(`INSERT OR REPLACE INTO documents (id, case_id, original_name, storage_key, mime_type, byte_size, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(documentId, caseId, file.name, key, file.type || "application/octet-stream", file.size, String(form.get("classification") || "Por confirmar"), Number(form.get("confidence") || 0)).run();
  return Response.json({ documentId, storageKey: key }, { status: 201 });
}
