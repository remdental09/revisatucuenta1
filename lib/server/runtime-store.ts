import type { DocumentExtraction } from "../extraction/types";
import type { ClinicalAccountAnalysis } from "../rules/chilean-account";

type LocalCase = { id: string; patient_name: string; episode_label: string; status: string; created_at: string; updated_at: string };
type LocalDocument = { id: string; case_id: string; original_name: string; mime_type: string; byte_size: number; classification: string; classification_confidence: number; page_from?: number; page_to?: number; created_at: string };
type LocalActivity = { id: string; case_id: string; title: string; detail: string; event_at: string; pending: number };

type LocalRuntimeState = {
  cases: Map<string, LocalCase>;
  documents: Map<string, LocalDocument>;
  extractions: Map<string, DocumentExtraction>;
  analyses: Map<string, { analysis: ClinicalAccountAnalysis; updatedAt: string }>;
  authorizations: Map<string, { authorized: number; scope: string; authorizedAt: string }>;
  activities: LocalActivity[];
};

const runtimeGlobal = globalThis as typeof globalThis & { __revisaTuCuentaLocalState?: LocalRuntimeState };
const localState = runtimeGlobal.__revisaTuCuentaLocalState ??= {
  cases: new Map<string, LocalCase>(),
  documents: new Map<string, LocalDocument>(),
  extractions: new Map<string, DocumentExtraction>(),
  analyses: new Map<string, { analysis: ClinicalAccountAnalysis; updatedAt: string }>(),
  authorizations: new Map<string, { authorized: number; scope: string; authorizedAt: string }>(),
  activities: [],
};

const { cases, documents, extractions, analyses, authorizations, activities } = localState;

export async function getCloudflareEnv(): Promise<any | null> {
  // Render demo mode is intentionally volatile: it must never attach or
  // discover a durable Cloudflare database/bucket while running the analyzer.
  if (typeof process !== "undefined" && process.env.REVISA_VOLATILE_MODE === "true") return null;
  try {
    const module = await import("cloudflare:workers");
    return module.env ?? null;
  } catch {
    return null;
  }
}

function now() { return new Date().toISOString(); }
function addActivity(caseId: string, title: string, detail: string) {
  activities.unshift({ id: crypto.randomUUID(), case_id: caseId, title, detail, event_at: now(), pending: 0 });
}

export function localListCases() {
  return [...cases.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((item) => ({
    ...item, document_count: [...documents.values()].filter((doc) => doc.case_id === item.id).length,
  }));
}

export function localCreateCase(input: { id: string; patientName?: string; episodeLabel: string }) {
  const timestamp = now();
  cases.set(input.id, { id: input.id, patient_name: input.patientName || "Paciente", episode_label: input.episodeLabel, status: "collecting", created_at: timestamp, updated_at: timestamp });
  addActivity(input.id, "Caso creado", "Se abrió el expediente para revisión.");
}

export function localGetCase(id: string) {
  const item = cases.get(id);
  if (!item) return null;
  const caseDocuments = [...documents.values()].filter((document) => document.case_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((document) => ({
    id: document.id, caseId: document.case_id, name: document.original_name, mimeType: document.mime_type, byteSize: document.byte_size,
    classification: document.classification, confidence: document.classification_confidence, pageFrom: document.page_from, pageTo: document.page_to,
    createdAt: document.created_at, extraction: extractions.get(document.id),
  }));
  const analysis = analyses.get(id);
  const authorization = authorizations.get(id);
  return {
    case: { id: item.id, patientName: item.patient_name, episodeLabel: item.episode_label, status: item.status, createdAt: item.created_at, updatedAt: item.updated_at },
    documents: caseDocuments, analysis: analysis?.analysis, analysisUpdatedAt: analysis?.updatedAt,
    authorization: authorization ? { authorized: authorization.authorized === 1, scope: authorization.scope, at: authorization.authorizedAt } : undefined,
    activities: activities.filter((activity) => activity.case_id === id).map((activity) => ({ id: activity.id, title: activity.title, detail: activity.detail, date: activity.event_at, pending: activity.pending === 1 })),
  };
}

export function localGetDocuments(caseId: string) { return [...documents.values()].filter((document) => document.case_id === caseId); }

export function localSaveDocument(input: { id: string; caseId: string; name: string; mimeType: string; byteSize: number; classification: string; confidence: number }) {
  const timestamp = now();
  documents.set(input.id, { id: input.id, case_id: input.caseId, original_name: input.name, mime_type: input.mimeType, byte_size: input.byteSize, classification: input.classification, classification_confidence: input.confidence, created_at: timestamp });
  addActivity(input.caseId, "Documento incorporado", `${input.name} quedó disponible para revisión.`);
  const item = cases.get(input.caseId);
  if (item && item.status === "collecting") {
    cases.set(input.caseId, { ...item, status: "under_review", updated_at: timestamp });
    addActivity(input.caseId, "Revisión iniciada", "El expediente quedó en cola para revisión interna.");
  }
}

export function localDeleteDocument(documentId: string, caseId: string) {
  const document = documents.get(documentId);
  if (!document || document.case_id !== caseId) return null;
  documents.delete(documentId);
  extractions.delete(documentId);
  analyses.delete(caseId);
  addActivity(caseId, "Documento eliminado", `${document.original_name} fue retirado del expediente.`);
  const remaining = [...documents.values()].some((item) => item.case_id === caseId);
  const currentCase = cases.get(caseId);
  if (currentCase) cases.set(caseId, { ...currentCase, status: remaining ? "under_review" : "collecting", updated_at: now() });
  return { id: document.id, name: document.original_name };
}

export function localSaveExtraction(documentId: string, extraction: DocumentExtraction, savedFields: number) {
  extractions.set(documentId, extraction);
  const document = documents.get(documentId);
  if (document) addActivity(document.case_id, "Extracción completada", `${savedFields} campos quedaron vinculados a su documento de origen.`);
}

export function localSaveAnalysis(caseId: string, analysis: ClinicalAccountAnalysis) {
  const timestamp = now();
  analyses.set(caseId, { analysis, updatedAt: timestamp });
  const item = cases.get(caseId);
  if (item) cases.set(caseId, { ...item, status: "analysis_ready", updated_at: timestamp });
  addActivity(caseId, "Análisis completado", "La cuenta clínica quedó clasificada y trazable por línea.");
}

export function localAuthorize(caseId: string, scope: string, authorizedAt: string) {
  authorizations.set(caseId, { authorized: 1, scope, authorizedAt });
  addActivity(caseId, "Autorización registrada", "El paciente autorizó preparar solicitudes de aclaración y reclamos.");
}
