import type { DocumentExtraction, ExtractionField } from "../../../lib/extraction/types";
import { extractedPatientField, isPlaceholderPatientName } from "../../../lib/extraction/patient-identity.ts";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localSaveExtraction } from "../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../lib/server/auth.ts";
import { documentAccess } from "../../../lib/server/case-access.ts";

type ExtractionRequest = { documentId?: string; extraction?: DocumentExtraction };

function rows(extraction: DocumentExtraction) {
  const groups = [extraction.account, extraction.pam].filter(Boolean);
  return groups.flatMap((group) =>
    (group?.fields ?? []).map((field: ExtractionField) => ({
      ...field,
      key: `${group?.type}.${field.key}`,
    })),
  );
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as ExtractionRequest;
  if (!body.documentId || !body.extraction) {
    return Response.json({ error: "Extracción o documento ausente" }, { status: 400 });
  }
  const fields = rows(body.extraction);
  const patientField = extractedPatientField(body.extraction);
  const env = await getCloudflareEnv();
  const access = await documentAccess(env, body.documentId, auth.user);
  if ("response" in access) return access.response;
  if (!env?.DB) {
    localSaveExtraction(body.documentId, body.extraction, fields.length, patientField?.value);
    return Response.json({ savedFields: fields.length, patientNameRegistered: Boolean(patientField) }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  if (fields.length) {
    await env.DB.batch(
      fields.map((field) =>
        env.DB.prepare(
          `INSERT OR REPLACE INTO extracted_fields (id, document_id, field_key, field_value, source_page, source_region, source_text, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          body.documentId,
          field.key,
          field.value,
          field.page,
          field.sourceRegion || null,
          field.sourceText || null,
          field.confidence,
        ),
      ),
    );
  }
  await env.DB.prepare(`INSERT INTO document_extractions (id, document_id, extraction_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(document_id) DO UPDATE SET extraction_json = excluded.extraction_json, updated_at = CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), body.documentId, JSON.stringify(body.extraction)).run();
  const document = await env.DB.prepare(`SELECT d.case_id, d.storage_key, d.source_expires_at, c.patient_name FROM documents d JOIN cases c ON c.id = d.case_id WHERE d.id = ?`).bind(body.documentId).first();
  if (document?.case_id) {
    if (patientField && isPlaceholderPatientName(String(document.patient_name || ""))) {
      await env.DB.prepare(`UPDATE cases SET patient_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(patientField.value, String(document.case_id)).run();
      await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), String(document.case_id), "Paciente identificado", "El nombre informado en la cuenta clínica quedó asociado al expediente.").run();
    }
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), String(document.case_id), "Extracción completada", "Los campos y líneas quedaron vinculados a su documento de origen.").run();
  }
  const reviewRequired = body.extraction.readerAssessment?.status !== "ready";
  await env.DB.prepare(`UPDATE documents SET processing_status = ?, processing_error = NULL WHERE id = ?`)
    .bind(reviewRequired ? "review_required" : "ready", body.documentId).run();
  if (reviewRequired && document?.case_id) {
    await env.DB.prepare(`UPDATE cases SET status = 'human_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(String(document.case_id)).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail, pending) VALUES (?, ?, ?, ?, 1)`)
      .bind(crypto.randomUUID(), String(document.case_id), "Revisión humana requerida", "El formato o algunos renglones necesitan validación antes de emitir un resultado.").run();
  }
  let sourceDeleted = false;
  if (!reviewRequired && env.DOCUMENTS && document?.storage_key) {
    try {
      await env.DOCUMENTS.delete(String(document.storage_key));
      await env.DB.prepare(`UPDATE documents SET source_deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.documentId).run();
      sourceDeleted = true;
    } catch {
      // The retention deadline remains recorded so an opportunistic cleanup can retry.
    }
  }
  return Response.json({
    savedFields: fields.length,
    patientNameRegistered: Boolean(patientField),
    processingStatus: reviewRequired ? "review_required" : "ready",
    sourceDeleted,
    sourceRetainedUntil: reviewRequired && document?.source_expires_at ? String(document.source_expires_at) : undefined,
  }, { status: 201 });
}
