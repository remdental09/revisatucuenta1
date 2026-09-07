import type { DocumentExtraction, ExtractionField } from "../../../lib/extraction/types";
import { extractedPatientField, isPlaceholderPatientName } from "../../../lib/extraction/patient-identity.ts";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localSaveExtraction, localSaveMixedExtraction } from "../../../lib/server/runtime-store.ts";
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

function extractionForKind(extraction: DocumentExtraction, kind: "account" | "pam"): DocumentExtraction {
  return kind === "account"
    ? { ...extraction, pam: undefined }
    : { ...extraction, account: undefined, pageKinds: extraction.pageKinds?.filter((page) => page.kind === "pam") };
}

function isMixedAccountDocument(classification: string, extraction: DocumentExtraction) {
  return Boolean(extraction.account && extraction.pam && /cuenta|mixto/i.test(classification));
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as ExtractionRequest;
  if (!body.documentId || !body.extraction) {
    return Response.json({ error: "Extracción o documento ausente" }, { status: 400 });
  }
  const patientField = extractedPatientField(body.extraction);
  const env = await getCloudflareEnv();
  const access = await documentAccess(env, body.documentId, auth.user);
  if ("response" in access) return access.response;
  if (!env?.DB) {
    const mixed = Boolean(body.extraction.account && body.extraction.pam);
    const derivedPamDocumentId = mixed
      ? localSaveMixedExtraction(body.documentId, body.extraction, rows(body.extraction).length, patientField?.value)
      : (localSaveExtraction(body.documentId, body.extraction, rows(body.extraction).length, patientField?.value), undefined);
    return Response.json({ savedFields: rows(body.extraction).length, patientNameRegistered: Boolean(patientField), derivedPamDocumentId }, { status: 201 });
  }
  await ensureCaseSchema(env.DB);
  const document = await env.DB.prepare(`SELECT d.case_id, d.original_name, d.storage_key, d.mime_type, d.byte_size, d.classification, d.classification_confidence, d.source_expires_at, d.source_deleted_at, c.patient_name FROM documents d JOIN cases c ON c.id = d.case_id WHERE d.id = ?`).bind(body.documentId).first() as Record<string, unknown> | null;
  if (!document?.case_id) return Response.json({ error: "Documento no encontrado" }, { status: 404 });
  const mixed = isMixedAccountDocument(String(document.classification || ""), body.extraction);
  const pamOnly = !mixed && /pam|liquid/i.test(String(document.classification || "")) && Boolean(body.extraction.pam);
  const accountExtraction = mixed
    ? extractionForKind(body.extraction, "account")
    : pamOnly
      ? extractionForKind(body.extraction, "pam")
      : body.extraction;
  const pamExtraction = mixed ? extractionForKind(body.extraction, "pam") : undefined;
  const accountFields = rows(accountExtraction);
  const pamFields = pamExtraction ? rows(pamExtraction) : [];

  // Re-reads replace the extracted field rows; otherwise a previous attempt
  // could leave stale or duplicated values attached to the document.
  await env.DB.prepare(`DELETE FROM extracted_fields WHERE document_id = ?`).bind(body.documentId).run();
  if (accountFields.length) {
    await env.DB.batch(
      accountFields.map((field) =>
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
    .bind(crypto.randomUUID(), body.documentId, JSON.stringify(accountExtraction)).run();

  let derivedPamDocumentId: string | undefined;
  if (mixed && pamExtraction) {
    const derivedClassification = "PAM / liquidación · detectado automáticamente";
    const derivedStorageKey = `derived/${body.documentId}/pam`;
    const existing = await env.DB.prepare(`SELECT id FROM documents WHERE case_id = ? AND classification = ? AND storage_key = ?`).bind(String(document.case_id), derivedClassification, derivedStorageKey).first() as { id?: string } | null;
    derivedPamDocumentId = existing?.id ? String(existing.id) : crypto.randomUUID();
    if (!existing) {
      await env.DB.prepare(`INSERT INTO documents (id, case_id, original_name, storage_key, mime_type, byte_size, classification, classification_confidence, processing_status, source_expires_at, source_deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(derivedPamDocumentId, String(document.case_id), String(document.original_name || "PAM detectado.pdf"), derivedStorageKey, String(document.mime_type || "application/pdf"), Number(document.byte_size || 0), derivedClassification, Number(document.classification_confidence || 0), body.extraction.readerAssessment?.status === "ready" ? "ready" : "review_required", document.source_expires_at ? String(document.source_expires_at) : null)
        .run();
    } else {
      await env.DB.prepare(`DELETE FROM extracted_fields WHERE document_id = ?`).bind(derivedPamDocumentId).run();
      await env.DB.prepare(`UPDATE documents SET processing_status = ?, processing_error = NULL, source_deleted_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(body.extraction.readerAssessment?.status === "ready" ? "ready" : "review_required", derivedPamDocumentId).run();
    }
    if (pamFields.length) {
      await env.DB.batch(
        pamFields.map((field) => env.DB.prepare(
          `INSERT OR REPLACE INTO extracted_fields (id, document_id, field_key, field_value, source_page, source_region, source_text, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), derivedPamDocumentId, field.key, field.value, field.page, field.sourceRegion || null, field.sourceText || null, field.confidence)),
      );
    }
    await env.DB.prepare(`INSERT INTO document_extractions (id, document_id, extraction_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(document_id) DO UPDATE SET extraction_json = excluded.extraction_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), derivedPamDocumentId, JSON.stringify(pamExtraction)).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), String(document.case_id), "PAM detectado automáticamente", "El lector encontró páginas de PAM dentro de la cuenta y las dejó disponibles como fuente separada para conciliación.").run();
  }

  const patientAccountField = extractedPatientField(accountExtraction);
  if (document?.case_id) {
    if (patientAccountField && isPlaceholderPatientName(String(document.patient_name || ""))) {
      await env.DB.prepare(`UPDATE cases SET patient_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(patientAccountField.value, String(document.case_id)).run();
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
  return Response.json({
    savedFields: accountFields.length + pamFields.length,
    patientNameRegistered: Boolean(patientAccountField),
    derivedPamDocumentId,
    processingStatus: reviewRequired ? "review_required" : "ready",
    sourceDeleted: false,
    sourceRetainedUntil: undefined,
  }, { status: 201 });
}
