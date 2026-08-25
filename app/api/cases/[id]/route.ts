import { ensureCaseSchema, jsonOrNull } from "../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetCase } from "../../../../lib/server/runtime-store.ts";
import type { DocumentExtraction } from "../../../../lib/extraction/types";
import type { ClinicalAccountAnalysis } from "../../../../lib/rules/chilean-account";
import { getCorpusContributionStatus } from "../../../../lib/server/observed-corpus-store.ts";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const env = await getCloudflareEnv();
  if (!env?.DB) {
    const snapshot = localGetCase(id);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    return Response.json({ ...snapshot, corpusStatus: await getCorpusContributionStatus(env, id) });
  }
  await ensureCaseSchema(env.DB);
  const caseResult = await env.DB.prepare(`SELECT * FROM cases WHERE id = ?`).bind(id).first();
  if (!caseResult) return Response.json({ error: "Caso no encontrado" }, { status: 404 });

  const [documentsResult, extractionsResult, analysisResult, authorizationResult, activitiesResult] = await Promise.all([
    env.DB.prepare(`SELECT id, case_id, original_name, mime_type, byte_size, classification, classification_confidence, page_from, page_to, created_at FROM documents WHERE case_id = ? ORDER BY created_at ASC`).bind(id).all(),
    env.DB.prepare(`SELECT de.document_id, de.extraction_json FROM document_extractions de JOIN documents d ON d.id = de.document_id WHERE d.case_id = ?`).bind(id).all(),
    env.DB.prepare(`SELECT analysis_json, updated_at FROM case_analyses WHERE case_id = ?`).bind(id).first(),
    env.DB.prepare(`SELECT authorized, scope, authorized_at FROM claim_authorizations WHERE case_id = ?`).bind(id).first(),
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
    pageFrom: document.page_from == null ? undefined : Number(document.page_from),
    pageTo: document.page_to == null ? undefined : Number(document.page_to),
    createdAt: String(document.created_at),
    extraction: extractionByDocument.get(String(document.id)),
  }));

  return Response.json({
    case: {
      id: String(caseResult.id),
      patientName: String(caseResult.patient_name),
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
