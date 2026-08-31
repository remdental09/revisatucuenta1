import { ensureCaseSchema, jsonOrNull } from "../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetCase } from "../../../../lib/server/runtime-store.ts";
import type { DocumentExtraction } from "../../../../lib/extraction/types";
import type { ClinicalAccountAnalysis } from "../../../../lib/rules/chilean-account";
import { getCorpusContributionStatus } from "../../../../lib/server/observed-corpus-store.ts";
import { requireApiUser } from "../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../lib/server/case-access.ts";
import { recoverStaleDatabaseExtractions } from "../../../../lib/server/extraction-watchdog.ts";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;
  if (!env?.DB) {
    const snapshot = localGetCase(id, auth.user.id, true);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    return Response.json({ ...snapshot, corpusStatus: await getCorpusContributionStatus(env, id) });
  }
  await ensureCaseSchema(env.DB);
  await recoverStaleDatabaseExtractions(env.DB, id);
  const caseResult = await env.DB.prepare(`SELECT * FROM cases WHERE id = ?`).bind(id).first();
  if (!caseResult) return Response.json({ error: "Caso no encontrado" }, { status: 404 });

  const [documentsResult, extractionsResult, analysisResult, authorizationResult, contractResult, activitiesResult] = await Promise.all([
    env.DB.prepare(`SELECT id, case_id, original_name, mime_type, byte_size, classification, classification_confidence, processing_status, processing_error, source_expires_at, source_deleted_at, page_from, page_to, created_at FROM documents WHERE case_id = ? ORDER BY created_at ASC`).bind(id).all(),
    env.DB.prepare(`SELECT de.document_id, de.extraction_json FROM document_extractions de JOIN documents d ON d.id = de.document_id WHERE d.case_id = ?`).bind(id).all(),
    env.DB.prepare(`SELECT analysis_json, updated_at FROM case_analyses WHERE case_id = ?`).bind(id).first(),
    env.DB.prepare(`SELECT authorized, scope, authorized_at FROM claim_authorizations WHERE case_id = ?`).bind(id).first(),
    env.DB.prepare(`SELECT id, case_id, contract_version, status, patient_name, patient_email, company_name, episode_label, contract_text, price_clp, accepted_terms, data_consent, mandate_consent, signer_name, accepted_at, payment_status, payment_url, created_at, updated_at FROM service_contracts WHERE case_id = ?`).bind(id).first(),
    env.DB.prepare(`SELECT id, title, detail, event_at, pending FROM case_activities WHERE case_id = ? ORDER BY event_at DESC`).bind(id).all(),
  ]);

  const extractionByDocument = new Map<string, DocumentExtraction>();
  for (const row of extractionsResult.results) {
    const extraction = jsonOrNull<DocumentExtraction>(row.extraction_json);
    if (extraction) extractionByDocument.set(String(row.document_id), extraction);
  }
  const documents = (documentsResult.results as Array<Record<string, unknown>>).map((document) => ({
    id: String(document.id),
    caseId: String(document.case_id),
    name: String(document.original_name),
    mimeType: String(document.mime_type),
    byteSize: Number(document.byte_size),
    classification: String(document.classification),
    confidence: Number(document.classification_confidence),
    processingStatus: String(document.processing_status || "uploaded"),
    processingError: document.processing_error ? String(document.processing_error) : undefined,
    sourceExpiresAt: document.source_expires_at ? String(document.source_expires_at) : undefined,
    sourceDeletedAt: document.source_deleted_at ? String(document.source_deleted_at) : undefined,
    pageFrom: document.page_from == null ? undefined : Number(document.page_from),
    pageTo: document.page_to == null ? undefined : Number(document.page_to),
    createdAt: String(document.created_at),
    extraction: extractionByDocument.get(String(document.id)),
  }));

  return Response.json({
    case: {
      id: String(caseResult.id),
      patientName: String(caseResult.patient_name),
      contactEmail: caseResult.contact_email ? String(caseResult.contact_email) : undefined,
      episodeLabel: String(caseResult.episode_label),
      status: String(caseResult.status),
      createdAt: String(caseResult.created_at),
      updatedAt: String(caseResult.updated_at),
    },
    documents,
    analysis: jsonOrNull<ClinicalAccountAnalysis>(analysisResult?.analysis_json),
    analysisUpdatedAt: analysisResult?.updated_at ? String(analysisResult.updated_at) : undefined,
    authorization: authorizationResult?.authorized ? {
      authorized: Number(authorizationResult.authorized) === 1,
      scope: String(authorizationResult.scope),
      at: authorizationResult.authorized_at ? String(authorizationResult.authorized_at) : undefined,
    } : undefined,
    contract: contractResult ? {
      id: String(contractResult.id),
      caseId: String(contractResult.case_id),
      contractVersion: String(contractResult.contract_version),
      status: String(contractResult.status),
      patientName: String(contractResult.patient_name),
      patientEmail: String(contractResult.patient_email),
      companyName: String(contractResult.company_name),
      episodeLabel: String(contractResult.episode_label),
      contractText: String(contractResult.contract_text),
      priceClp: Number(contractResult.price_clp || 0),
      acceptedTerms: Number(contractResult.accepted_terms) === 1,
      dataConsent: Number(contractResult.data_consent) === 1,
      mandateConsent: Number(contractResult.mandate_consent) === 1,
      signerName: contractResult.signer_name ? String(contractResult.signer_name) : undefined,
      acceptedAt: contractResult.accepted_at ? String(contractResult.accepted_at) : undefined,
      paymentStatus: String(contractResult.payment_status || "not_started"),
      paymentUrl: contractResult.payment_url ? String(contractResult.payment_url) : undefined,
      createdAt: String(contractResult.created_at),
      updatedAt: String(contractResult.updated_at),
    } : undefined,
    activities: (activitiesResult.results as Array<Record<string, unknown>>).map((activity) => ({
      id: String(activity.id),
      title: String(activity.title),
      detail: String(activity.detail),
      date: String(activity.event_at),
      pending: Number(activity.pending) === 1,
    })),
    corpusStatus: await getCorpusContributionStatus(env, id),
  });
}
