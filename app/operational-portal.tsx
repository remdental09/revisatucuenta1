"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { extractHealthcareDocument, extractionErrorMessage, prepareVisionPageImages } from "../lib/extraction/client";
import { CURRENT_READER_VERSION, type DocumentExtraction, type ReaderAssistResponse, type VisionAssistResponse } from "../lib/extraction/types";
import { assessExtractionQuality, buildReaderChangeProposal, buildReaderReviewPackage, readerChangeProposalToMarkdown, readerReviewPackageToMarkdown } from "../lib/extraction/reader-quality";
import type { ClinicalAccountAnalysis, ChileanBillingLine, InclusionCandidate } from "../lib/rules/chilean-account";
import type { FunctionalEquivalenceAlert } from "../lib/rules/observed-corpus";
import { generateClarificationClaimMarkdown } from "../lib/claims/claim-generator";
import { normalizeChileanRun } from "../lib/identity/chilean-run";
import {
  EQUALITY_PROJECTION_FRAMEWORK,
  FULL_OPERATING_ROOM_FRAMEWORK,
  UNIVERSAL_CLAIM_FRAMEWORK,
} from "../lib/claims/legal-basis";

type CaseDocument = {
  id: string;
  caseId: string;
  name: string;
  mimeType: string;
  byteSize: number;
  classification: string;
  confidence: number;
  processingStatus?: string;
  processingError?: string;
  sourceExpiresAt?: string;
  sourceDeletedAt?: string;
  createdAt: string;
  extraction?: DocumentExtraction;
};
type Activity = { id: string; title: string; detail: string; date: string; pending?: boolean };
type Authorization = { authorized: boolean; scope: string; at?: string };
type ServiceContract = {
  id: string;
  caseId: string;
  contractVersion: string;
  status: "draft" | "accepted" | "paid_demo" | string;
  patientName: string;
  patientEmail: string;
  companyName: string;
  episodeLabel: string;
  contractText: string;
  priceClp: number;
  acceptedTerms: boolean;
  dataConsent: boolean;
  mandateConsent: boolean;
  signerName?: string;
  acceptedAt?: string;
  paymentStatus: string;
  paymentUrl?: string;
  createdAt: string;
  updatedAt: string;
};
type Snapshot = {
  case: { id: string; patientName: string; patientRun?: string; contactEmail?: string; episodeLabel: string; status: string; createdAt: string; updatedAt: string };
  documents: CaseDocument[];
  analysis?: ClinicalAccountAnalysis;
  authorization?: Authorization;
  contract?: ServiceContract;
  activities: Activity[];
  corpusStatus?: "pending_review" | "validated" | "rejected";
};

const PILOT_RESET_VERSION = "2026-08-30-empty-console-v2";
type CaseRow = { id: string; patient_name: string; patient_run?: string; episode_label: string; status: string; document_count: number };
type SessionUser = { id: string; email: string; displayName: string; source: "chatgpt" | "email" | "development" | "pilot" };

const money = (value: number) => `$${Math.round(value || 0).toLocaleString("es-CL")}`;

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

function useAuthSession(surface: "patient" | "developer") {
  const [user, setUser] = useState<SessionUser>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch(`/api/auth/session?view=${surface}`, { cache: "no-store" })
      .then(async (response) => response.json().catch(() => ({ authenticated: false })))
      .then((payload) => { if (active) setUser(payload.authenticated ? payload.user : undefined); })
      .catch(() => { if (active) setUser(undefined); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [surface]);
  return { user, loading };
}

function signOutHref(user: SessionUser) {
  return user.source === "chatgpt" ? "/signout-with-chatgpt?return_to=%2F" : "/api/auth/logout";
}

function PortalBrand({ className = "", href }: { className?: string; href?: string }) {
  const content = <><span>R</span><span className="portal-brand-copy"><strong>RevisaTuCuenta</strong><small>Revisa tus cuentas de hospitalización en clínicas</small></span></>;
  return href ? <a className={`portal-brand ${className}`.trim()} href={href}>{content}</a> : <div className={`portal-brand ${className}`.trim()}>{content}</div>;
}

function AuthenticationLoading() {
  return <main className="patient-login"><section className="patient-login-card"><PortalBrand/><h1>Verificando acceso…</h1><p>Estamos protegiendo el acceso a tus expedientes.</p></section></main>;
}

function DeveloperAccessUnavailable() {
  return <main className="patient-login"><section className="patient-login-card"><PortalBrand/><div className="login-seal">⌁</div><p className="portal-kicker">CONSOLA DE DESARROLLO</p><h1>Acceso de desarrollo no habilitado.</h1><p>Esta consola no usa claves de piloto. Para abrirla durante el piloto, el entorno debe tener habilitado el modo de desarrollo abierto.</p><p className="patient-contact-note">Configuración requerida: <strong>REVISA_DEVELOPER_OPEN=true</strong></p><a className="back-link" href="/">← Volver</a></section></main>;
}

function EmailAccess({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [developmentVerifyUrl, setDevelopmentVerifyUrl] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); setDevelopmentVerifyUrl("");
    try {
      const response = await fetch("/api/auth/email/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, returnTo }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el enlace de acceso");
      setMessage(payload.message || "Revisa tu correo para continuar.");
      setDevelopmentVerifyUrl(payload.developmentVerifyUrl || "");
    } catch (reason) { setError(errorMessage(reason, "No se pudo verificar el correo")); }
    finally { setBusy(false); }
  }
  return <main className="patient-login"><form className="patient-login-card" onSubmit={submit}><PortalBrand/><div className="login-seal">⌁</div><p className="portal-kicker">ACCESO PROTEGIDO</p><h1>Ingresa a tu expediente.</h1><p>Te enviaremos un enlace para verificar tu correo. Así nadie más podrá consultar tus documentos ni resultados.</p><input aria-label="Correo electrónico" type="email" required autoComplete="email" placeholder="Tu correo electrónico" value={email} onChange={(event) => setEmail(event.target.value)} />{message && <p className="patient-analysis-notice">{message}</p>}{error && <p className="developer-empty-error">{error}</p>}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "Enviando enlace…" : "Enviar enlace de acceso"}</button>{developmentVerifyUrl && <a className="portal-button portal-button-secondary" href={developmentVerifyUrl}>Abrir enlace local de prueba</a>}<p className="patient-contact-note">El enlace vence en 15 minutos. Tu sesión queda protegida y sólo muestra los expedientes asociados a este correo verificado.</p><a className="back-link" href="/">← Volver</a></form></main>;
}

async function getSnapshot(caseId: string) {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo cargar el caso");
  return payload as Snapshot;
}

function accountDoc(snapshot?: Snapshot) {
  return snapshot?.documents.filter((doc) => /cuenta|mixto/i.test(doc.classification) || doc.extraction?.account).slice(-1)[0];
}

function pamDoc(snapshot?: Snapshot) {
  return snapshot?.documents.filter((doc) => /pam|liquid/i.test(doc.classification) || doc.extraction?.pam).slice(-1)[0];
}

function accountField(snapshot: Snapshot, pattern: RegExp) {
  return accountDoc(snapshot)?.extraction?.account?.fields.find((field) => pattern.test(`${field.key} ${field.label}`));
}

function patientNameForDeveloper(snapshot: Snapshot) {
  return accountField(snapshot, /^(?:patient|paciente)\b/i)?.value || snapshot.case.patientName || "Paciente";
}

function totalFrom(doc: CaseDocument | undefined, kind: "account" | "pam") {
  const group = doc?.extraction?.[kind];
  const fieldKey = kind === "account" ? "total" : "billed_total";
  const field = group?.fields.find((item) => item.key === fieldKey);
  const fieldValue = field ? Number(field.value.replace(/[^0-9-]/g, "")) : 0;
  return fieldValue || group?.lines.reduce((sum, line) => sum + line.amount, 0) || 0;
}

function extractionNeedsRefresh(document?: CaseDocument) {
  return Boolean(document?.extraction && document.extraction.readerVersion !== CURRENT_READER_VERSION);
}

function analysisBlocked(document?: CaseDocument) {
  if (!document) return true;
  if (["failed", "pending", "extracting"].includes(document.processingStatus || "")) return true;
  if (!document.extraction?.account?.lines.length) return true;
  return extractionNeedsRefresh(document);
}

function hideStaleAnalysis(snapshot: Snapshot) {
  const account = accountDoc(snapshot);
  if (!extractionNeedsRefresh(account)) return snapshot;
  return {
    ...snapshot,
    analysis: undefined,
    documents: snapshot.documents.map((document) => document.id === account?.id
      ? { ...document, processingStatus: "review_required", processingError: "La cuenta fue extraída con un lector anterior; debe releerse." }
      : document),
  };
}

function possibleDisputeLines(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.lineAssessments ?? [])
    .filter((assessment) => Boolean(bestCombinedCandidate(analysis, assessment)));
}

function possibleDisputeAmount(analysis?: ClinicalAccountAnalysis) {
  return possibleDisputeLines(analysis)
    .reduce((sum, assessment) => sum + assessment.line.amount, 0);
}

const DEVELOPER_CANDIDATE_THRESHOLD = 0.45;
const LLM_CANDIDATE_THRESHOLD = 0.7;
type DeveloperLineAssessment = ClinicalAccountAnalysis["lineAssessments"][number];
type DeveloperCategoryKey = "access" | "medication" | "monitoring" | "surgical" | "field";

const developerCategoryLabels: Record<DeveloperCategoryKey, string> = {
  access: "Acceso, infusión, vía aérea y aspiración",
  medication: "Medicamentos y anestesia",
  monitoring: "Monitorización y electrocirugía",
  surgical: "Material quirúrgico y suturas",
  field: "Campo, asepsia y curación",
};

const normalizeDeveloperText = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function developerCategoryForLine(line: ChileanBillingLine): DeveloperCategoryKey {
  const text = normalizeDeveloperText(line.description);
  if (/sevo|propofol|metadona|lidoc|atropina|duratears/.test(text)) return "medication";
  if (/electrodo|oxisensor|sensor|placa valley/.test(text)) return "monitoring";
  if (/neurosorb|prolene|vicryl|ethilon|bisturi|electrobisturi|canula frazier|contador d[\\/ ]aguja/.test(text)) return "surgical";
  if (/gasa|guante|bata|mascarilla|sachet|torula|micropore|allevyn|povidona|lapiz marcador/.test(text)) return "field";
  return "access";
}

function bestDeveloperCandidate(assessment: DeveloperLineAssessment, bundle?: "operating_room") {
  return assessment.candidates
    .filter((candidate) => candidate.probability >= DEVELOPER_CANDIDATE_THRESHOLD && (!bundle || candidate.bundle === bundle))
    .sort((left, right) => right.probability - left.probability)[0];
}

function llmCandidateForLine(
  analysis: ClinicalAccountAnalysis | undefined,
  lineId: string,
  bundle?: "operating_room",
): InclusionCandidate | undefined {
  const sourceLine = analysis?.lineAssessments.find((item) => item.line.id === lineId)?.line;
  const description = normalizeDeveloperText(sourceLine?.description);
  if (/\bdia cama\b|\b(?:derecho de |derecho )?pabellon(?: quirurgico)?\b/.test(description)) return;
  const hypothesis = analysis?.llmAssist?.lineHypotheses
    .filter((item) =>
      item.lineId === lineId
      && item.decision === "review"
      && item.confidence >= LLM_CANDIDATE_THRESHOLD
      && item.bundle !== "procedure"
      && item.bundle !== "professional_fees"
      && item.bundle !== "unassigned"
      && (!bundle || item.bundle === bundle),
    )
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (!hypothesis) return;
  return {
    bundle: hypothesis.bundle,
    probability: hypothesis.confidence,
    knowledgeIds: ["LLM-SECOND-READER-001"],
    precedentIds: [],
    precedentSupport: 0,
    reasons: [hypothesis.rationale, ...hypothesis.evidence].filter(Boolean),
    missingEvidence: hypothesis.missingEvidence,
  };
}

function bestCombinedCandidate(
  analysis: ClinicalAccountAnalysis | undefined,
  assessment: DeveloperLineAssessment,
  bundle?: "operating_room",
) {
  const deterministic = bestDeveloperCandidate(assessment, bundle);
  const assisted = llmCandidateForLine(analysis, assessment.line.id, bundle);
  if (!deterministic) return assisted;
  if (!assisted) return deterministic;
  return assisted.probability > deterministic.probability ? assisted : deterministic;
}

type DeveloperBreakdownItem = {
  code: string;
  description: string;
  count: number;
  amount: number;
  probability: number;
};

type DeveloperBreakdownCategory = {
  key: DeveloperCategoryKey;
  label: string;
  count: number;
  amount: number;
  zeroCount: number;
  items: DeveloperBreakdownItem[];
};

function buildDeveloperBreakdown(analysis: ClinicalAccountAnalysis) {
  const pavilionRows = analysis.lineAssessments.flatMap((assessment) => {
    const candidate = bestCombinedCandidate(analysis, assessment, "operating_room");
    return candidate ? [{ assessment, candidate }] : [];
  });
  const pavilionLineIds = new Set(pavilionRows.map(({ assessment }) => assessment.line.id));
  const categoryMap = new Map<DeveloperCategoryKey, { count: number; amount: number; zeroCount: number; items: Map<string, DeveloperBreakdownItem> }>();

  for (const key of Object.keys(developerCategoryLabels) as DeveloperCategoryKey[]) {
    categoryMap.set(key, { count: 0, amount: 0, zeroCount: 0, items: new Map() });
  }
  for (const { assessment, candidate } of pavilionRows) {
    const line = assessment.line;
    const key = developerCategoryForLine(line);
    const category = categoryMap.get(key)!;
    category.count += 1;
    category.amount += line.amount;
    if (line.amount === 0) category.zeroCount += 1;
    const itemKey = `${line.code ?? ""}|${line.description}`;
    const item = category.items.get(itemKey) ?? {
      code: line.code ?? "—",
      description: line.description,
      count: 0,
      amount: 0,
      probability: 0,
    };
    item.count += 1;
    item.amount += line.amount;
    item.probability = Math.max(item.probability, candidate.probability);
    category.items.set(itemKey, item);
  }

  const alternatives = analysis.lineAssessments.flatMap((assessment) => {
    const candidate = bestCombinedCandidate(analysis, assessment);
    return candidate && candidate.bundle !== "operating_room" ? [{
      line: assessment.line,
      candidate,
      overlapsPavilion: pavilionLineIds.has(assessment.line.id),
    }] : [];
  });

  const categories = (Object.keys(developerCategoryLabels) as DeveloperCategoryKey[])
    .map((key) => {
      const category = categoryMap.get(key)!;
      return {
        key,
        label: developerCategoryLabels[key],
        count: category.count,
        amount: category.amount,
        zeroCount: category.zeroCount,
        items: [...category.items.values()].sort((left, right) => right.amount - left.amount || left.description.localeCompare(right.description)),
      } satisfies DeveloperBreakdownCategory;
    })
    .filter((category) => category.count > 0);

  const uniqueCandidateAmount = possibleDisputeAmount(analysis);
  return {
    pavilionRows,
    categories,
    alternatives,
    uniqueCandidateAmount,
    pavilionAmount: pavilionRows.reduce((sum, { assessment }) => sum + assessment.line.amount, 0),
    zeroCount: pavilionRows.filter(({ assessment }) => assessment.line.amount === 0).length,
  };
}

function expectedKind(classification: string): "account" | "pam" | "unknown" {
  if (/pam|liquid/i.test(classification)) return "pam";
  if (/cuenta|mixto/i.test(classification)) return "account";
  return "unknown";
}

function processingLabel(document?: CaseDocument) {
  if (!document) return "Pendiente";
  if (document.processingStatus === "failed") return `Falló la lectura${document.processingError ? `: ${document.processingError}` : ""}`;
  if (document.processingStatus === "review_required") return "Lectura pendiente de revisión humana";
  if (document.processingStatus === "extracting") return "Extracción en curso";
  if (document.processingStatus === "ready" && document.sourceDeletedAt) return "Extraído · original eliminado";
  if (document.processingStatus === "ready" || document.extraction) return "Extraído";
  return "Pendiente";
}

type UploadDocumentOptions = { registerCorpus?: boolean };
type PendingUpload = { name: string; classification: string };

async function registerCorpusObservation(caseId: string, documentId: string, extraction: DocumentExtraction, classification: string) {
  const sourceKind = /pam|liquid/i.test(classification)
    ? "pam"
    : /cuenta|mixto/i.test(classification)
      ? "account"
      : undefined;
  if (!sourceKind) return false;
  const sourceLines = (extraction[sourceKind]?.lines ?? []).map((line, index) => ({ ...line, id: `${documentId}-${index}`, documentId }));
  if (!sourceLines.length) return false;
  const corpusResponse = await fetch("/api/corpus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, sourceKind, sourceDocumentId: documentId, episodeClass: classification, lines: sourceLines }),
  });
  return corpusResponse.ok;
}

async function uploadDocument(caseId: string, file: File, classification: string, onProgress?: (value: number) => void, options: UploadDocumentOptions = {}) {
  const documentId = crypto.randomUUID();
  const body = new FormData();
  body.append("caseId", caseId);
  body.append("documentId", documentId);
  body.append("classification", classification);
  body.append("confidence", "95");
  body.append("file", file);
  const upload = await fetch("/api/documents", { method: "POST", body });
  if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).error || "No se pudo guardar el documento");
  // Keep a visible non-zero state while the PDF/OCR reader is initializing.
  // Scanned PDFs can spend several seconds here before Tesseract emits its
  // first page-level progress event.
  onProgress?.(2);
  try {
    const extracted = await extractHealthcareDocument(file, expectedKind(classification), onProgress);
    const extraction: DocumentExtraction = {
      ...extracted,
      readerAssessment: assessExtractionQuality(extracted, expectedKind(classification)),
    };
    const saved = await fetch("/api/extractions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId, extraction }),
    });
    if (!saved.ok) throw new Error((await saved.json().catch(() => ({}))).error || "El documento se guardó, pero la extracción no pudo persistirse");
    const corpusRegistered = options.registerCorpus === false
      ? false
      : await registerCorpusObservation(caseId, documentId, extraction, classification);
    return { documentId, extraction, corpusRegistered };
  } catch (reason) {
    await fetch("/api/documents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, documentId, status: "failed", error: extractionErrorMessage(reason) }),
    }).catch(() => undefined);
    throw reason;
  }
}

async function persistExtraction(documentId: string, extraction: DocumentExtraction) {
  const response = await fetch("/api/extractions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId, extraction }),
  });
  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({}))).error || "La lectura asistida terminó, pero no pudo guardarse");
  }
}

function mergeVisionCorrections(extraction: DocumentExtraction, response: VisionAssistResponse) {
  const source = extraction.account;
  if (!source || response.status !== "ready_for_review") return { extraction, appliedCount: 0 };
  const lines = source.lines.map((line) => ({ ...line }));
  let appliedCount = 0;
  for (const correction of response.result.lineCorrections) {
    if (correction.confidence < 0.9 || !correction.description.trim() || correction.amount === null || correction.amount < 0) continue;
    const index = correction.index - 1;
    const current = lines[index];
    if (current && current.page === correction.page) {
      const nextCode = correction.code || current.code;
      lines[index] = {
        ...current,
        description: correction.description,
        code: nextCode || undefined,
        quantity: correction.quantity ?? current.quantity,
        unitAmount: correction.unitAmount ?? current.unitAmount,
        amount: correction.amount,
        numericReconciled: false,
        assistedBy: "openai_vision",
        assistConfidence: correction.confidence,
        originalDescription: current.originalDescription ?? current.description,
        originalCode: current.originalCode ?? current.code,
        originalAmount: current.originalAmount ?? current.amount,
      };
      appliedCount += 1;
      continue;
    }
    if (!source.lines.length) {
      lines.push({
        description: correction.description,
        code: correction.code || undefined,
        quantity: correction.quantity ?? undefined,
        unitAmount: correction.unitAmount ?? undefined,
        amount: correction.amount,
        page: correction.page,
        confidence: Math.round(correction.confidence * 100),
        sourceText: correction.evidence,
        assistedBy: "openai_vision",
        assistConfidence: correction.confidence,
      });
      appliedCount += 1;
    }
  }
  if (!appliedCount) return { extraction, appliedCount: 0 };
  const base: DocumentExtraction = {
    ...extraction,
    account: { ...source, lines },
    readerAssessment: undefined,
  };
  const assessment = assessExtractionQuality(base, "account");
  const assisted: DocumentExtraction = {
    ...base,
    readerAssessment: {
      ...assessment,
      llmAssist: { ...assessment.llmAssist, status: "ready_for_review" },
      signals: [
        ...assessment.signals,
        `GPT Vision corrigió ${appliedCount} renglón(es) con confianza igual o superior a 90%; los valores originales quedaron conservados en la trazabilidad.`,
      ],
    },
  };
  return { extraction: assisted, appliedCount };
}

async function retryStoredDocument(caseId: string, document: CaseDocument, onProgress?: (value: number) => void) {
  const sourceUrl = `/api/documents?caseId=${encodeURIComponent(caseId)}&documentId=${encodeURIComponent(document.id)}&download=source`;
  const statusResponse = await fetch("/api/documents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, documentId: document.id, status: "extracting" }),
  });
  if (!statusResponse.ok) throw new Error((await statusResponse.json().catch(() => ({}))).error || "No se pudo iniciar el reintento");

  onProgress?.(2);
  try {
    const sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
    if (!sourceResponse.ok) throw new Error((await sourceResponse.json().catch(() => ({}))).error || "El original temporal ya no está disponible");
    const sourceBlob = await sourceResponse.blob();
    const sourceFile = new File([sourceBlob], document.name, { type: document.mimeType || sourceBlob.type || "application/pdf" });
    const extracted = await extractHealthcareDocument(sourceFile, expectedKind(document.classification), onProgress);
    const extraction: DocumentExtraction = {
      ...extracted,
      readerAssessment: assessExtractionQuality(extracted, expectedKind(document.classification)),
    };
    const saved = await fetch("/api/extractions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: document.id, extraction }),
    });
    if (!saved.ok) throw new Error((await saved.json().catch(() => ({}))).error || "La relectura terminó, pero no pudo guardarse");
    const corpusRegistered = await registerCorpusObservation(caseId, document.id, extraction, document.classification);
    return { documentId: document.id, extraction, corpusRegistered };
  } catch (reason) {
    await fetch("/api/documents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, documentId: document.id, status: "failed", error: extractionErrorMessage(reason) }),
    }).catch(() => undefined);
    throw reason;
  }
}

async function deleteDocumentRequest(caseId: string, documentId: string) {
  const response = await fetch(`/api/documents?caseId=${encodeURIComponent(caseId)}&documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo borrar el documento");
  return payload as { documentId: string; deleted: boolean; name?: string };
}

async function replaceAccountDocument(caseId: string, previous: CaseDocument, file: File, onProgress?: (value: number) => void) {
  const replacement = await uploadDocument(caseId, file, "Cuenta clínica", onProgress, { registerCorpus: false });
  try {
    await deleteDocumentRequest(caseId, previous.id);
    const corpusRegistered = await registerCorpusObservation(caseId, replacement.documentId, replacement.extraction, "Cuenta clínica");
    return { ...replacement, corpusRegistered };
  } catch (reason) {
    // If the old document could not be removed, roll back the new one so the
    // case never exposes two competing clinical accounts.
    await deleteDocumentRequest(caseId, replacement.documentId).catch(() => undefined);
    throw reason;
  }
}

async function analyzeCase(caseId: string, document?: CaseDocument, episodeLabel?: string) {
  if (extractionNeedsRefresh(document)) {
    throw new Error("La cuenta fue leída con una versión anterior. Reemplaza la cuenta clínica para aplicar el lector actualizado.");
  }
  const lines: ChileanBillingLine[] = document?.extraction?.account?.lines.map((line, index) => ({
    ...line,
    id: `${document.id}-${index}`,
    documentId: document.id,
  })) ?? [];
  if (!lines.length) throw new Error("La cuenta no tiene líneas extraídas para analizar");
  const totalField = document?.extraction?.account?.fields.find((field) => field.key === "total");
  const printedTotal = totalField ? Number(totalField.value.replace(/[^0-9-]/g, "")) : undefined;
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId,
      episodeLabel,
      lines,
      readerAssessment: document?.extraction?.readerAssessment,
      printedTotal: Number.isFinite(printedTotal) ? printedTotal : undefined,
    }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "No se pudo analizar la cuenta");
  return response.json() as Promise<ClinicalAccountAnalysis>;
}

function emptyVisionExtraction(): DocumentExtraction {
  return {
    pageCount: 4,
    usedOcr: true,
    account: { type: "account", label: "Cuenta clínica", pages: [], fields: [], lines: [] },
  };
}

function visionPagesForExtraction(extraction: DocumentExtraction) {
  const assessment = extraction.readerAssessment ?? assessExtractionQuality(extraction, "account");
  const pageCount = Math.max(1, extraction.pageCount || 4);
  const prioritized = [
    ...assessment.lowConfidencePages,
    ...(extraction.ocrEnhancements?.map((item) => item.page) || []),
    ...(extraction.ocrPages || []),
  ];
  const fallback = Array.from({ length: Math.min(pageCount, 4) }, (_, index) => index + 1);
  return [...new Set([...prioritized, ...fallback])]
    .filter((page) => page <= pageCount)
    .slice(0, 4);
}

function visionGridForExtraction(extraction: DocumentExtraction): 3 | 4 {
  const assessment = extraction.readerAssessment ?? assessExtractionQuality(extraction, "account");
  const severe = !extraction.account?.lines.length || assessment.confidence < 0.45 || assessment.unknownItems.length >= 3 || assessment.numericIssues.length >= 2;
  return severe ? 4 : 3;
}

function shouldAutoVision(extraction: DocumentExtraction) {
  const assessment = extraction.readerAssessment ?? assessExtractionQuality(extraction, "account");
  return !extraction.account?.lines.length ||
    assessment.status === "reader_change_needed" ||
    assessment.confidence < 0.70 ||
    assessment.lowConfidencePages.length > 0 ||
    Boolean(extraction.ocrEnhancements?.length) ||
    assessment.numericIssues.length > 0;
}

type VisionSourceDocument = Pick<CaseDocument, "id" | "caseId" | "name" | "mimeType"> & { sourceDeletedAt?: string };

async function requestVisionReview(
  caseId: string,
  sourceDocument: VisionSourceDocument,
  extraction: DocumentExtraction,
  sourceFile: File | undefined,
  onProgress?: (progress: number) => void,
) {
  if (sourceDocument.sourceDeletedAt) throw new Error("El original temporal ya no está disponible para GPT Vision.");
  const pages = visionPagesForExtraction(extraction);
  if (!pages.length) throw new Error("No hay páginas seleccionadas para revisión visual.");
  let file = sourceFile;
  if (!file) {
    const sourceUrl = `/api/documents?caseId=${encodeURIComponent(caseId)}&documentId=${encodeURIComponent(sourceDocument.id)}&download=source`;
    const sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
    if (!sourceResponse.ok) {
      const payload = await sourceResponse.json().catch(() => ({}));
      throw new Error(payload.error || "El original temporal ya no está disponible para visión.");
    }
    const sourceBlob = await sourceResponse.blob();
    file = new File([sourceBlob], sourceDocument.name, { type: sourceDocument.mimeType || sourceBlob.type || "application/pdf" });
  }
  const gridSize = visionGridForExtraction(extraction);
  const images = await prepareVisionPageImages(file, pages, (value) => {
    onProgress?.(Math.max(3, Math.min(55, Math.round(3 + value * 0.52))));
  }, { gridSize });
  if (!images.length) throw new Error("No se pudieron preparar zonas de las páginas seleccionadas.");
  onProgress?.(60);
  const response = await fetch("/api/vision-assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, documentId: sourceDocument.id, expectedKind: "account", extraction, images }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo solicitar GPT Vision");
  onProgress?.(100);
  return payload as VisionAssistResponse;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadReaderProposal(filename: string, sourceDocument: CaseDocument) {
  const assessment = sourceDocument.extraction?.readerAssessment;
  if (!assessment) return;
  const proposal = buildReaderChangeProposal(assessment, sourceDocument.name);
  const blob = new Blob([readerChangeProposalToMarkdown(proposal)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadReaderReviewPackage(filename: string, sourceDocument: CaseDocument) {
  const extraction = sourceDocument.extraction;
  if (!extraction) return;
  const review = buildReaderReviewPackage(sourceDocument.name, extraction);
  const blob = new Blob([readerReviewPackageToMarkdown(review)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function markdownCell(value: unknown) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function bundleLabel(bundle: string) {
  return ({
    operating_room: "Derecho de pabellón",
    hospital_stay: "Día cama / hospitalización",
    hospitalized_medication: "Medicamentos hospitalizados",
    procedure: "Procedimiento",
    professional_fees: "Honorarios profesionales",
    unassigned: "Sin asignar",
    personal_item_review: "Revisión de artículo personal",
  } as Record<string, string>)[bundle] || bundle;
}

function functionalAlertLevelLabel(level: FunctionalEquivalenceAlert["alertLevel"]) {
  return ({ high: "Alerta alta", medium: "Alerta media", context: "Requiere contexto" } as const)[level];
}

function analysisToMarkdown(analysis: ClinicalAccountAnalysis) {
  const framework = analysis.claimFramework ?? UNIVERSAL_CLAIM_FRAMEWORK;
  const equality = analysis.equalityProjection ?? EQUALITY_PROJECTION_FRAMEWORK;
  const operatingRoom = analysis.operatingRoomFramework ?? FULL_OPERATING_ROOM_FRAMEWORK;
  const candidateCount = analysis.lineAssessments.filter((item) => Boolean(bestCombinedCandidate(analysis, item))).length;
  const precedentCount = analysis.lineAssessments.reduce((sum, item) => sum + (item.precedentComparisons?.length ?? 0), 0);
  const functionalAlerts = analysis.functionalEquivalenceAlerts ?? [];
  const accountSignals = analysis.accountSignals ?? [];
  const reasoningFindings = analysis.reasoningFindings ?? [];
  const functionalRows = functionalAlerts.map((alert) => {
    const targets = alert.targetBundles.map((bundle) => bundleLabel(bundle)).join(" / ");
    const support = `${alert.observedPatternCount} patrones / ${alert.observedObservationCount} observaciones / ${alert.observedCaseKeys.length} casos`;
    return `| ${markdownCell(functionalAlertLevelLabel(alert.alertLevel))} | ${markdownCell(alert.lineDescription)} | ${markdownCell(alert.familyLabel)} | ${markdownCell(targets)} | ${Math.round(alert.comparability * 100)}% | ${support} | ${markdownCell(alert.matchedSignals.join(", "))} | ${markdownCell(alert.evidenceToRequest.join("; "))} |`;
  });
  const functionalFoundations = functionalAlerts.map((alert) => `- **${markdownCell(alert.lineDescription)} — ${markdownCell(alert.familyLabel)}:** ${markdownCell(alert.rationale)} ${markdownCell(alert.caution)} Fuentes: ${markdownCell(alert.sourceBasis.join("; "))}.`);
  const rows = analysis.lineAssessments.map((assessment, index) => {
    const combinedCandidates = [...assessment.candidates];
    const assistedCandidate = llmCandidateForLine(analysis, assessment.line.id);
    if (assistedCandidate && !combinedCandidates.some((candidate) => candidate.bundle === assistedCandidate.bundle)) {
      combinedCandidates.push(assistedCandidate);
    }
    const hypotheses = combinedCandidates.length
      ? combinedCandidates.map((candidate) => {
          const evidence = candidate.missingEvidence.length
            ? `Falta: ${candidate.missingEvidence.join("; ")}`
            : "Sin evidencia faltante declarada";
          const source = candidate.knowledgeIds.includes("LLM-SECOND-READER-001") ? "Segunda lectura LLM" : `IDs: ${candidate.knowledgeIds.join(", ") || "—"}`;
          return `${bundleLabel(candidate.bundle)} (${Math.round(candidate.probability * 100)}%). ${evidence}. ${source}`;
        }).join("<br>")
      : "Sin hipótesis de inclusión";
    const observed = assessment.observedEquivalents.length
      ? assessment.observedEquivalents.slice(0, 3).map((item) => `${item.description} (${Math.round(item.equivalenceProbability * 100)}%, ${item.matchBasis})`).join("<br>")
      : "Sin equivalencia observada";
    const precedent = assessment.precedentComparisons?.length
      ? assessment.precedentComparisons.map((comparison) => `${comparison.label} → ${comparison.outcomeLabel || bundleLabel(comparison.outcomeBundle)} (${Math.round(comparison.comparability * 100)}%, ${comparison.status})`).join("<br>")
      : "Sin antecedente comparable";
    return `| ${index + 1} | ${markdownCell(assessment.line.date)} | ${markdownCell(assessment.line.page)} | ${markdownCell(assessment.line.code)} | ${markdownCell(assessment.line.description)} | ${money(assessment.line.amount)} | ${markdownCell(assessment.line.section || "Sin sección")} | ${markdownCell(hypotheses)} | ${markdownCell(precedent)} | ${markdownCell(observed)} |`;
  }).join("\n");
  const anomalies = analysis.anomalies.length
    ? analysis.anomalies.map((anomaly) => `| ${markdownCell(anomaly.severity)} | ${markdownCell(anomaly.type)} | ${markdownCell(anomaly.lineIds.join(", "))} | ${markdownCell(anomaly.explanation)} |`).join("\n")
    : "| — | — | — | No se detectaron señales adicionales. |";
  const structuralSignals = accountSignals.length
    ? accountSignals.map((signal) => `| ${markdownCell(signal.severity)} | ${markdownCell(signal.type)} | ${markdownCell(signal.lineIds.join(", "))} | ${markdownCell(signal.summary)} | ${markdownCell(signal.evidenceToRequest.join("; "))} |`).join("\n")
    : "| — | — | — | No se detectaron señales estructurales adicionales. | — |";
  return [
    "# Matriz de trazabilidad de cuenta clínica",
    "",
    `- Versión: ${analysis.version}`,
    `- Líneas analizadas: ${analysis.lineAssessments.length}`,
    `- Hipótesis de inclusión: ${candidateCount}`,
    `- Comparaciones con antecedentes arbitrales: ${precedentCount}`,
    `- Alertas universales de equivalencia funcional: ${functionalAlerts.length}`,
    `- Señales de cuenta: ${analysis.anomalies.length}`,
    `- Criterios de control activados o pendientes: ${reasoningFindings.filter((finding) => finding.status !== "not_triggered").length}`,
    "",
    "> Este archivo es una salida técnica para revisión de desarrollo. Una probabilidad expresa una hipótesis de pertenencia a una prestación principal; no acredita por sí sola un cobro improcedente ni una devolución garantizada.",
    "",
    "## Criterio de lectura",
    "",
    "- Las hipótesis deben contrastarse con contrato, convenio, arancel, PAM, registro de uso y resolución aplicable.",
    "- Las equivalencias observadas muestran similitud con casos del corpus; no son decisiones de cobertura.",
    "- La igualdad ante la ley se usa como regla de comparación material: un antecedente arbitral permite pedir trato coherente, pero no crea cobertura automática.",
    "- Las señales de duplicidad requieren revisar el registro clínico, de administración o de consumo.",
    "",
    "## Fundamento común del generador de reclamos",
    "",
    `> ${framework.legalBasis}`,
    "",
    `- Aplicación: ${framework.appliesTo}`,
    `- Artículos considerados: ${framework.articles.join(", ")}`,
    `- Uso: ${framework.usageNote}`,
    "",
    "## Proyección caso a caso por igualdad ante la ley",
    "",
    `- Marco: ${equality.version}`,
    `- Base constitucional: ${equality.constitutionalBasis}`,
    `- Rol del antecedente: ${equality.precedentRole}`,
    `- Regla de proyección: ${equality.projectionRule}`,
    "",
    "### Factores de comparación",
    "",
    ...equality.comparisonFactors.map((factor) => `- ${factor}`),
    "",
    "### Evidencia faltante o necesaria",
    "",
    ...equality.requiredEvidence.map((evidence) => `- ${evidence}`),
    "",
    "### Límites",
    "",
    ...equality.limits.map((limit) => `- ${limit}`),
    "",
    "## Alcance integral del Derecho de Pabellón",
    "",
    `> ${operatingRoom.sourceRule}`,
    "",
    `- Regla de aplicación: ${operatingRoom.applicationRule}`,
    "",
    "### Categorías comprendidas",
    "",
    ...operatingRoom.includedCategories.map((category) => `- ${category}`),
    "",
    "### Distinciones y límites",
    "",
    ...operatingRoom.expressDistinctions.map((distinction) => `- ${distinction}`),
    ...operatingRoom.limits.map((limit) => `- ${limit}`),
    "",
    "### Fuentes",
    "",
    ...operatingRoom.sourceReferences.map((source) => `- ${source}`),
    "",
    "## Expansiones cognitivas aplicadas",
    "",
    "> Estos criterios provienen de la jurisprudencia y los compendios revisados. El motor los usa para detectar qué debe probarse o pedirse, no para afirmar automáticamente cobertura o infracción.",
    "",
    "| Estado | Criterio | Acción | Fuentes |",
    "|---|---|---|---|",
    ...(reasoningFindings.length
      ? reasoningFindings.map((finding) => `| ${markdownCell(finding.status)} | ${markdownCell(finding.title)} | ${markdownCell(finding.action)} | ${markdownCell(finding.sourceReferences.join("; "))} |`)
      : ["| — | No hay criterios de control disponibles en esta versión del análisis. | — | — |"]),
    "",
    "## Alertas universales de equivalencia funcional",
    "",
    "> Esta sección agrupa glosas por función clínica y las contrasta con el universo observado de cuentas. Una alerta no declara cobertura: orienta qué rubro, registro de uso y regla contractual deben verificarse.",
    "",
    "| Nivel | Línea | Familia funcional | Destino posible | Comparabilidad técnica | Soporte del corpus | Señales | Evidencia a pedir |",
    "|---|---|---|---|---:|---|---|---|",
    ...(functionalAlerts.length
      ? functionalRows
      : ["| — | — | No se detectaron equivalencias funcionales en esta cuenta. | — | — | — | — | — |"]),
    "",
    "### Fundamento de las alertas",
    "",
    ...(functionalAlerts.length
      ? functionalFoundations
      : ["- No hay fundamentos funcionales activados."]),
    "",
    "## Segunda lectura LLM",
    "",
    analysis.llmAssist
      ? `- Estado: ${analysis.llmAssist.status}`
      : "- Estado: no ejecutada",
    analysis.llmAssist?.model ? `- Modelo: ${analysis.llmAssist.model}` : "- Modelo: —",
    analysis.llmAssist?.summary ? `- Resumen: ${analysis.llmAssist.summary}` : "- Resumen: sin segunda lectura disponible.",
    analysis.llmAssist
      ? `- Contexto: ${analysis.llmAssist.episode.type}; pabellón ${analysis.llmAssist.episode.hasOperatingRoom ? "sí" : "no"}; hospitalización ${analysis.llmAssist.episode.hasHospitalStay ? "sí" : "no"}; urgencia ${analysis.llmAssist.episode.hasEmergency ? "sí" : "no"}.`
      : "- Contexto: —",
    "",
    "> Las propuestas LLM quedan separadas de las reglas deterministas y sólo se suman al monto preliminar cuando señalan revisión con confianza igual o superior al 70%.",
    "",
    "## Matriz línea por línea",
    "",
    "| # | Fecha | Página | Código | Glosa | Monto | Sección | Hipótesis de control | Antecedente comparable | Equivalencias observadas |",
    "|---:|---|---:|---|---|---:|---|---|---|---|",
    rows,
    "",
    "## Señales de cuenta",
    "",
    "| Severidad | Tipo | Líneas | Explicación |",
    "|---|---|---|---|",
    anomalies,
    "",
    "## Paquetes, valores cero y trazabilidad estructural",
    "",
    "> Estas señales buscan paquetes, componentes sin cargo, cargos administrativos, múltiples entidades y separación temporal del episodio. No prueban intención ni generan por sí solas un monto recuperable.",
    "",
    "| Severidad | Tipo | Líneas | Señal | Evidencia a solicitar |",
    "|---|---|---|---|---|",
    structuralSignals,
    "",
    "## Corpus observado",
    "",
    `- Casos: ${analysis.observedCorpus.caseCount}`,
    `- Observaciones: ${analysis.observedCorpus.observationCount}`,
    `- Patrones: ${analysis.observedCorpus.patternCount}`,
    `- Aportes pendientes de validación: ${analysis.observedCorpus.pendingContributionCount ?? 0}`,
    `- Aportes validados incorporados: ${analysis.observedCorpus.validatedContributionCount ?? 0}`,
    `- Estado de esta cuenta: ${analysis.corpusLearning?.status ?? "no registrado"}`,
    `- Límite de aprendizaje: ${analysis.observedCorpus.learningBoundary}`,
    "",
    "## Limitaciones",
    "",
    ...analysis.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
}

function downloadMarkdown(filename: string, analysis: ClinicalAccountAnalysis) {
  const blob = new Blob([analysisToMarkdown(analysis)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadClaim(filename: string, snapshot: Snapshot) {
  const blob = new Blob([
    generateClarificationClaimMarkdown({
      caseId: snapshot.case.id,
      patientName: snapshot.case.patientName,
      episodeLabel: snapshot.case.episodeLabel,
      analysis: snapshot.analysis,
    }),
  ], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PortalEntry() {
  return (
    <main className="portal-entry">
      <div className="portal-entry-glow" />
      <div className="portal-entry-card">
        <PortalBrand/>
        <p className="portal-kicker">Revisión de cuentas de hospitalización</p>
        <h1>Sube tu cuenta de hospitalización y revisémosla juntos.</h1>
        <p className="portal-entry-copy">Recibe una primera revisión clara de los cobros y posibles inconsistencias de tu cuenta clínica.</p>
        <div className="portal-entry-actions">
          <a className="portal-button portal-button-primary" href="/?view=patient">Entrada paciente</a>
          <a className="portal-button portal-button-secondary developer-entry-button" href="/?view=developer">Entrada desarrolladores ↗</a>
        </div>
        <div className="portal-entry-foot"><span>●</span> Tu información se mantiene protegida</div>
      </div>
    </main>
  );
}

function PatientStart({ userEmail, onCreated }: { userEmail: string; onCreated: (caseId: string) => void }) {
  const [name, setName] = useState("");
  const [run, setRun] = useState("");
  const [episode, setEpisode] = useState("Revisión de cuenta clínica");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const created = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, patientName: name.trim(), patientRun: normalizeChileanRun(run), episodeLabel: episode, requirePatientIdentity: true }) });
      const payload = await created.json().catch(() => ({}));
      if (!created.ok) throw new Error(payload.error || "No se pudo crear el expediente");
      if (file) await uploadDocument(id, file, "Cuenta clínica");
      onCreated(id);
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo crear el expediente"));
    } finally {
      setBusy(false);
    }
  }

  return <main className="patient-login"><form className="patient-login-card" onSubmit={submit}><PortalBrand/><div className="login-seal">⌁</div><p className="portal-kicker">Nuevo expediente</p><h1>Comienza tu revisión.</h1><p>Tu expediente quedará asociado al correo verificado.</p><div className="patient-verified-email"><span>Correo verificado</span><strong>{userEmail}</strong></div><label className="patient-field">Nombre completo<input aria-label="Nombre completo" required autoComplete="name" placeholder="Ej. María Rodríguez" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="patient-field">RUN<input aria-label="RUN" required inputMode="numeric" autoComplete="off" placeholder="12.345.678-9" value={run} onChange={(event) => setRun(event.target.value)} onBlur={() => setRun(normalizeChileanRun(run))} /></label><label className="patient-field">Episodio o atención<input aria-label="Episodio" placeholder="Ej. Revisión de cuenta clínica" value={episode} onChange={(event) => setEpisode(event.target.value)} /></label><label className="portal-button portal-button-secondary"><input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(event) => setFile(event.target.files?.[0])} />{file ? file.name : "Cargar cuenta clínica"}</label>{error && <p className="patient-analysis-notice">{error}</p>}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "Creando expediente…" : "Crear expediente"}</button><p className="patient-contact-note">El RUN se usa sólo para identificar tu expediente y se trata junto con tus datos personales según la autorización informada. Recibirás un resultado preliminar; el documento original se cifra mientras se procesa.</p><a className="back-link" href="/">← Volver</a></form></main>;
}

export function PatientPortal({ initialCaseId = "" }: { initialCaseId?: string }) {
  const auth = useAuthSession("patient");
  if (auth.loading) return <AuthenticationLoading />;
  if (!auth.user) return <EmailAccess returnTo={`/?view=patient${initialCaseId ? `&case=${encodeURIComponent(initialCaseId)}` : ""}`} />;
  return <AuthenticatedPatientPortal initialCaseId={initialCaseId} user={auth.user} />;
}

function AuthenticatedPatientPortal({ initialCaseId = "", user }: { initialCaseId?: string; user: SessionUser }) {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<"Resumen" | "Documentos" | "Actividad">("Resumen");
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Esperando documentos");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [contractDraft, setContractDraft] = useState<ServiceContract>();
  const [contractOpen, setContractOpen] = useState(false);
  const [contractBusy, setContractBusy] = useState(false);
  const [contractError, setContractError] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const accountInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAnalysisKeyRef = useRef("");

  async function refresh() {
    if (!caseId) return;
    try { setError(""); const next = hideStaleAnalysis(await getSnapshot(caseId)); setSnapshot(next); if (next.analysis) setStatus("complete"); else setStatus("idle"); }
    catch (reason) { setError(errorMessage(reason, "No se pudo cargar el expediente")); }
  }
  useEffect(() => { void refresh(); }, [caseId]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3000); }

  async function handlePam(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !caseId) return;
    setBusy(true); setProgress(0); setStage("Guardando PAM / liquidación");
    try {
      await uploadDocument(caseId, file, "PAM / liquidación", (value) => { setProgress(value); setStage(value < 100 ? `Leyendo PAM / liquidación · ${value}%` : "Lectura del PAM completada"); });
      await refresh();
      notify("PAM cargado y vinculado al expediente");
    }
    catch (reason) {
      notify(errorMessage(reason, "No se pudo cargar el PAM"));
      await refresh();
    }
    finally { setBusy(false); }
  }

  async function handleAccount(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !caseId) return;
    const previousAccount = accountDoc(snapshot);
    setBusy(true); setProgress(0); setStage("Guardando cuenta clínica");
    try {
      const updateProgress = (value: number) => { setProgress(value); setStage(value < 100 ? `Leyendo cuenta clínica · ${value}%` : "Lectura de la cuenta completada"); };
      const result = previousAccount
        ? await replaceAccountDocument(caseId, previousAccount, file, updateProgress)
        : await uploadDocument(caseId, file, "Cuenta clinica", updateProgress);
      await refresh();
      notify(previousAccount
        ? "Cuenta clínica anterior eliminada y reemplazada correctamente"
        : result.corpusRegistered
          ? "Cuenta clínica cargada y vinculada al expediente"
          : "Cuenta clínica cargada; el aprendizaje quedó pendiente de sincronización");
    }
    catch (reason) {
      notify(errorMessage(reason, "No se pudo cargar la cuenta clínica"));
      await refresh();
    }
    finally { setBusy(false); }
  }

  async function runAnalysis() {
    if (!snapshot || !caseId) return;
    if (!accountDoc(snapshot)) { notify("Primero debes cargar la cuenta clínica"); return; }
    setBusy(true); setStatus("running"); setProgress(8); setStage("Preparando la cuenta");
    let simulatedProgress = 8;
    const timer = window.setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + 7, 88);
      setProgress(simulatedProgress);
      setStage(simulatedProgress < 35 ? "Ordenando los documentos" : simulatedProgress < 65 ? "Revisando los cargos" : "Preparando el resultado");
    }, 180);
    try {
      const analysis = await analyzeCase(caseId, accountDoc(snapshot), snapshot.case.episodeLabel);
      setSnapshot((current) => current ? {
        ...current,
        analysis,
        case: { ...current.case, status: "analysis_ready", updatedAt: new Date().toISOString() },
      } : current);
      setProgress(100); setStage("Resultado disponible para revisión"); setStatus("complete");
      await refresh(); notify("Análisis guardado en el expediente");
    }
    catch (reason) { setStatus("error"); setError(errorMessage(reason, "No se pudo analizar la cuenta")); }
    finally { window.clearInterval(timer); setBusy(false); }
  }

  useEffect(() => {
    const account = accountDoc(snapshot);
    if (!snapshot || !caseId || snapshot.analysis || status === "running" || busy || !account || analysisBlocked(account)) return;
    const key = `${caseId}:${account.id}`;
    if (autoAnalysisKeyRef.current === key) return;
    autoAnalysisKeyRef.current = key;
    void runAnalysis();
  }, [caseId, snapshot, status, busy]);

  async function openContract() {
    if (!caseId) return;
    setContractOpen(true);
    setContractBusy(true);
    setContractError("");
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/contract`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.contract) throw new Error(payload.error || "No se pudo cargar el contrato");
      setContractDraft(payload.contract as ServiceContract);
    } catch (reason) {
      setContractError(errorMessage(reason, "No se pudo cargar el contrato"));
    } finally { setContractBusy(false); }
  }

  async function acceptContract(input: { contractVersion: string; acceptedTerms: boolean; dataConsent: boolean; mandateConsent: boolean; signerName: string }) {
    setContractBusy(true);
    setContractError("");
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/contract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.contract) throw new Error(payload.error || "No se pudo registrar el contrato");
      setContractDraft(payload.contract as ServiceContract);
      await refresh();
      notify("Contrato registrado. El pago de prueba está disponible.");
    } catch (reason) {
      setContractError(errorMessage(reason, "No se pudo registrar el contrato"));
    } finally { setContractBusy(false); }
  }

  async function removeDocument(document: CaseDocument) {
    if (!caseId || !window.confirm(`¿Quieres borrar "${document.name}" del expediente? Esta acción también quitará su análisis asociado.`)) return;
    setBusy(true); setDeletingDocumentId(document.id);
    try {
      await deleteDocumentRequest(caseId, document.id);
      await refresh();
      notify("Documento borrado del expediente");
    } catch (reason) {
      notify(errorMessage(reason, "No se pudo borrar el documento"));
    } finally { setBusy(false); setDeletingDocumentId(""); }
  }

  if (!caseId) return <PatientStart userEmail={user.email} onCreated={setCaseId} />;
  if (error && !snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>No se pudo abrir el expediente</h2><p>{error}</p><button className="portal-button portal-button-primary" onClick={() => void refresh()}>Reintentar</button></section></main>;
  if (!snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>Cargando expediente…</h2></section></main>;

  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const accountTotal = totalFrom(account, "account"); const pamTotal = totalFrom(pam, "pam");
  const readerAssessment = account?.extraction?.readerAssessment;
  const readerNeedsRefresh = extractionNeedsRefresh(account);
  const patientAnalysis = readerNeedsRefresh ? undefined : snapshot.analysis;
  const patientReviewLines = possibleDisputeLines(patientAnalysis);
  const patientReviewAmount = patientReviewLines.reduce((sum, assessment) => sum + assessment.line.amount, 0);
  const patientHasIrregularities = patientReviewLines.length > 0;
  const patientCanAnalyze = !analysisBlocked(account);
  const patientStatus = patientAnalysis
    ? patientHasIrregularities ? "Irregularidades detectadas" : "Análisis completado"
    : account ? "Resultado en preparación" : "Expediente pendiente";
  const firstName = snapshot.case.patientName.split(" ")[0];
  return <main className="patient-portal">
    <header className="patient-topbar"><PortalBrand href="/"/><div className="patient-topbar-right"><span className="surface-pill patient-pill">Vista paciente</span><span className="avatar">{snapshot.case.patientName.slice(0, 2).toUpperCase()}</span><span className="patient-email">{user.email}</span><a className="patient-signout-button" href={signOutHref(user)} aria-label="Cerrar sesión">Cerrar sesión</a></div></header>
    <div className="patient-layout"><aside className="patient-sidebar"><div className="case-mini"><span className="case-icon">⌁</span><div><small>CASO ACTIVO</small><b>{snapshot.case.patientName}</b><span>RUN {snapshot.case.patientRun || "No informado"}</span><span>Expediente {caseId.slice(0, 8)}</span></div></div><nav className="patient-nav">{(["Resumen", "Documentos", "Actividad"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav><div className="patient-sidebar-help"><span>?</span><div><b>¿Necesitas ayuda?</b><small>Escríbenos sobre tu caso.</small></div></div></aside>
      <section className="patient-main"><div className="patient-heading"><div><p className="portal-kicker">Mi expediente</p><h1>Hola, {firstName}.</h1><p>{snapshot.case.episodeLabel}</p><div className="patient-identity-summary"><span>Paciente</span><strong>{snapshot.case.patientName}</strong><small>RUN {snapshot.case.patientRun || "No informado"}</small></div></div><span className="case-status"><i /> {patientStatus}</span></div>
         {tab === "Resumen" && <PatientSummary account={account} pam={pam} reviewAmount={patientReviewAmount} irregularityCount={patientReviewLines.length} analysisAvailable={Boolean(patientAnalysis)} analysisRunning={status === "running"} progress={progress} stage={stage} contract={snapshot.contract} busy={busy} readerReviewRequired={Boolean(readerNeedsRefresh || account?.processingStatus === "failed" || account?.processingStatus === "review_required" || (readerAssessment && readerAssessment.status !== "ready"))} readerChangeNeeded={!patientCanAnalyze} onAccount={() => accountInputRef.current?.click()} onPam={() => inputRef.current?.click()} onAnalyze={() => void runAnalysis()} onOpenContract={() => void openContract()} contractBusy={contractBusy} />}
        {tab === "Documentos" && <PatientDocuments snapshot={snapshot} deletingDocumentId={deletingDocumentId} onAccount={() => accountInputRef.current?.click()} onPam={() => inputRef.current?.click()} onDelete={(document) => void removeDocument(document)} />}
        {tab === "Actividad" && <PatientActivity activities={snapshot.activities} />}
      </section></div>
    <input ref={accountInputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={handleAccount} /><input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={handlePam} />{contractOpen && <PatientContractModal contract={contractDraft} busy={contractBusy} error={contractError} onClose={() => setContractOpen(false)} onAccept={(input) => void acceptContract(input)} />}{toast && <div className="portal-toast"><span>✓</span>{toast}</div>}
  </main>;
}

function AnalysisProgress({ progress, stage }: { progress: number; stage: string }) {
  return <section className="analysis-progress-card" aria-live="polite"><div className="analysis-progress-card-head"><div><span className="card-kicker">ANÁLISIS EN CURSO</span><b>{stage}</b></div><strong>{progress}%</strong></div><div className="analysis-progress-bar" role="progressbar" aria-label="Progreso del análisis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><small>Estamos revisando la cuenta clínica. El resultado es preliminar y quedará sujeto a revisión humana.</small></section>;
}

function UploadProgress({ progress, stage }: { progress: number; stage: string }) {
  return <section className="analysis-progress-card upload-progress-card" aria-live="polite"><div className="analysis-progress-card-head"><div><span className="card-kicker">LECTURA DE DOCUMENTO</span><b>{stage}</b></div><strong>{progress}%</strong></div><div className="analysis-progress-bar" role="progressbar" aria-label="Progreso de la lectura del documento" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><small>El documento se está guardando y leyendo. En cuentas escaneadas, esta etapa puede tardar algunos minutos.</small></section>;
}

function PatientSummary({ account, pam, reviewAmount, irregularityCount, analysisAvailable, analysisRunning, progress, stage, contract, busy, readerReviewRequired, readerChangeNeeded, onAccount, onPam, onAnalyze, onOpenContract, contractBusy }: { account?: CaseDocument; pam?: CaseDocument; reviewAmount: number; irregularityCount: number; analysisAvailable: boolean; analysisRunning: boolean; progress: number; stage: string; contract?: ServiceContract; busy: boolean; readerReviewRequired: boolean; readerChangeNeeded: boolean; onAccount: () => void; onPam: () => void; onAnalyze: () => void; onOpenContract: () => void; contractBusy: boolean }) {
  const accountReceived = Boolean(account);
  const pamReceived = Boolean(pam);
  const documentsReceived = accountReceived || pamReceived;
  const hasIrregularities = analysisAvailable && irregularityCount > 0;
  const irregularityLabel = `${irregularityCount} ${irregularityCount === 1 ? "cargo" : "cargos"}`;
  const summaryTitle = analysisAvailable
    ? hasIrregularities ? "Detectamos posibles irregularidades en tu cuenta" : "No detectamos irregularidades evidentes"
    : accountReceived ? "Tu cuenta está en revisión" : pamReceived ? "Documento de cobertura recibido" : "Completa tu expediente";
  const summaryCopy = analysisAvailable
    ? hasIrregularities
      ? `Encontramos ${irregularityLabel} que conviene revisar con más detalle. A continuación te mostramos el monto aproximado asociado.`
      : "Revisamos la información disponible y no encontramos cargos que indiquen una irregularidad evidente."
    : accountReceived
      ? "Ya recibimos tu cuenta. Te mostraremos si encontramos cargos que conviene revisar y el monto aproximado asociado."
      : pamReceived
        ? "Recibimos tu documento de cobertura. Para revisar posibles irregularidades necesitamos la cuenta clínica."
        : "Carga la cuenta clínica para conocer el resultado de la revisión.";
  const statusLabel = analysisAvailable
    ? hasIrregularities ? "Posibles irregularidades detectadas" : "Análisis preliminar completado"
    : accountReceived ? "Resultado en preparación" : pamReceived ? "Cobertura recibida; cuenta pendiente" : "Esperando documentos";
  return <>
    <section className="patient-card patient-review-status-card">
      <span className="card-kicker">ESTADO DEL EXPEDIENTE</span>
      <h2>{summaryTitle}</h2>
      <p>{summaryCopy}</p>
      <div className="patient-review-status">
        <span><i /> {statusLabel}</span>
        {analysisAvailable && <small>El resultado es preliminar y se basa en la información disponible en tu cuenta.</small>}
        {!analysisAvailable && readerReviewRequired && <small>Estamos verificando algunos datos antes de entregarte el resultado.</small>}
      </div>
      <div className="patient-review-flow" aria-label="Estado general del expediente">
        <div className={accountReceived ? "complete" : ""}><i>1</i><span>{accountReceived ? "Cuenta recibida" : "Cuenta pendiente"}</span></div>
        <div className={analysisAvailable ? "complete" : accountReceived ? "current" : ""}><i>2</i><span>{analysisAvailable ? "Resultado disponible" : accountReceived ? "Resultado en preparación" : "Resultado pendiente"}</span></div>
        <div className={pamReceived ? "complete" : ""}><i>3</i><span>{pamReceived ? "Cobertura recibida" : "Cobertura opcional"}</span></div>
      </div>
      {account && !analysisAvailable && readerChangeNeeded && <section className="patient-analysis-pending">
        <div><span className="card-kicker">RESULTADO EN PREPARACIÓN</span><h3>Estamos preparando el resultado de tu cuenta</h3><p>Ya recibimos tu cuenta. Estamos terminando de procesar algunos datos antes de mostrarte las posibles irregularidades y el monto aproximado.</p></div>
      </section>}
      {account && !analysisAvailable && !readerChangeNeeded && <section className="patient-analysis-launch">
        <div><span className="card-kicker">RESULTADO DE TU CUENTA</span><h3>{analysisRunning ? stage : "Obtén el resultado de tu cuenta"}</h3><p>{analysisRunning ? "Estamos revisando los cargos para identificar posibles irregularidades y estimar el monto asociado." : "Inicia el análisis para saber si hay cargos que conviene revisar y cuál es el monto aproximado."}</p></div>
        {analysisRunning ? <div className="patient-analysis-progress-wrap"><div className="patient-analysis-progress-label"><span>{progress}%</span><b>Procesando</b></div><div className="patient-analysis-progress-bar" role="progressbar" aria-label="Progreso del análisis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div></div> : <button className="patient-analyze-button" onClick={onAnalyze} disabled={busy}>Analizar mi cuenta →</button>}
      </section>}
      {analysisAvailable && <>
        <div className="patient-review-amount">
          <div><span className="card-kicker">{hasIrregularities ? "MONTO APROXIMADO A REVISAR" : "MONTO APROXIMADO IDENTIFICADO"}</span><strong>{money(reviewAmount)}</strong></div>
          <p>{hasIrregularities ? `El monto se relaciona con ${irregularityLabel} que conviene revisar. Es una estimación preliminar y no garantiza una devolución.` : "No identificamos un monto asociado a cargos que requieran revisión con la información disponible."}</p>
        </div>
        {hasIrregularities && reviewAmount > 0 && <section className="patient-advisory-card">
          <div><span className="card-kicker">ASESORÍA ESPECIALIZADA</span><h3>Revisa tu cuenta con Rakun</h3><p>Lee el contrato completo, autoriza de forma separada el tratamiento de tus datos de salud y el mandato limitado, y luego continúa al pago de demostración. El preinforme es preliminar y no garantiza una devolución.</p></div>
          {contract?.status === "accepted" || contract?.status === "paid_demo" ? <div className="patient-advisory-confirmed"><b>{contract.status === "paid_demo" ? "Pago de prueba registrado" : "Contrato aceptado"}</b><small>{contract.status === "paid_demo" ? "No se realizó ningún cobro real." : "Tu contrato quedó guardado para este expediente."}</small>{contract.paymentUrl && <a href={contract.paymentUrl} target="_blank" rel="noreferrer">{contract.status === "paid_demo" ? "Abrir comprobante de prueba →" : "Continuar al pago de prueba →"}</a>}</div> : <button className="portal-button portal-button-primary" onClick={onOpenContract} disabled={busy || contractBusy}>{contractBusy ? "Cargando contrato…" : "Leer contrato y continuar"} →</button>}
        </section>}
      </>}
      <div className="patient-review-actions"><button className="portal-button portal-button-secondary" onClick={onAccount} disabled={busy}>{account ? "Reemplazar cuenta clínica" : "Agregar cuenta clínica"}</button><button className="portal-button portal-button-primary" onClick={onPam} disabled={busy}>{pam ? "Reemplazar documento de cobertura" : "Agregar documento de cobertura"}</button></div>
    </section>
    <section className="patient-card next-card"><span className="card-kicker">SIGUIENTE PASO</span><h2>{analysisAvailable ? hasIrregularities ? "Revisa los cargos observados" : "Resultado de la revisión" : accountReceived ? "Obtén el resultado de tu cuenta" : pamReceived ? "Falta la cuenta clínica" : "Completa tus documentos"}</h2><p>{analysisAvailable ? hasIrregularities ? "Encontramos posibles irregularidades y te mostramos el monto aproximado asociado. Puedes solicitar una propuesta de asesoría para revisar los antecedentes." : "Con la información disponible no encontramos cargos que requieran revisión." : documentsReceived ? "Carga la cuenta clínica para obtener el resultado y el monto aproximado de la revisión." : "Carga la cuenta clínica para obtener el resultado de la revisión."}</p></section>
  </>;
}

function PatientContractModal({ contract, busy, error, onClose, onAccept }: { contract?: ServiceContract; busy: boolean; error: string; onClose: () => void; onAccept: (input: { contractVersion: string; acceptedTerms: boolean; dataConsent: boolean; mandateConsent: boolean; signerName: string }) => void }) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [mandateConsent, setMandateConsent] = useState(false);
  const [signerName, setSignerName] = useState("");

  useEffect(() => {
    if (!contract) return;
    setAcceptedTerms(contract.acceptedTerms);
    setDataConsent(contract.dataConsent);
    setMandateConsent(contract.mandateConsent);
    setSignerName(contract.signerName || "");
  }, [contract?.id]);

  function downloadContract() {
    if (!contract) return;
    const blob = new Blob([contract.contractText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `contrato-rakun-${contract.caseId.slice(0, 8)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const alreadyAccepted = contract?.status === "accepted" || contract?.status === "paid_demo";
  return <div className="contract-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="contract-modal" role="dialog" aria-modal="true" aria-labelledby="contract-modal-title">
      <header className="contract-modal-header"><div><span className="card-kicker">CONTRATO Y AUTORIZACIÓN</span><h2 id="contract-modal-title">{alreadyAccepted ? "Contrato registrado" : "Lee antes de continuar"}</h2><p>{contract ? `${contract.companyName} · ${contract.episodeLabel}` : "Preparando el documento…"}</p></div><button className="contract-modal-close" onClick={onClose} aria-label="Cerrar contrato">×</button></header>
      {!contract ? <div className="contract-loading">{busy ? "Cargando el contrato…" : "No se pudo cargar el contrato."}</div> : <>
        <div className="contract-meta"><span><b>Cliente</b>{contract.patientName}</span><span><b>Precio piloto</b>${contract.priceClp.toLocaleString("es-CL")} CLP</span><span><b>Versión</b>{contract.contractVersion}</span></div>
        <div className="contract-notice"><b>Importante</b><span>Este es un flujo de demostración. La aceptación en pantalla queda registrada, pero la versión de producción deberá incorporar firma electrónica avanzada o poder ante notario cuando el trámite lo requiera.</span></div>
        <pre className="contract-text">{contract.contractText}</pre>
        <div className="contract-modal-footer">
          <button className="portal-button portal-button-secondary" onClick={downloadContract}>Descargar copia</button>
          {alreadyAccepted ? <div className="contract-accepted-actions"><span>✓ Aceptación registrada{contract.acceptedAt ? ` · ${new Date(contract.acceptedAt).toLocaleString("es-CL")}` : ""}</span>{contract.paymentUrl && <a className="portal-button portal-button-primary" href={contract.paymentUrl} target="_blank" rel="noreferrer">Continuar al pago de prueba →</a>}</div> : <form className="contract-acceptance-form" onSubmit={(event) => { event.preventDefault(); onAccept({ contractVersion: contract.contractVersion, acceptedTerms, dataConsent, mandateConsent, signerName }); }}>
            <label className="contract-checkbox"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>He leído y acepto el contrato de prestación de servicios.</span></label>
            <label className="contract-checkbox"><input type="checkbox" checked={dataConsent} onChange={(event) => setDataConsent(event.target.checked)} /><span>Autorizo expresamente el tratamiento de mis datos personales y sensibles, incluidos datos de salud, sólo para los fines descritos.</span></label>
            <label className="contract-checkbox"><input type="checkbox" checked={mandateConsent} onChange={(event) => setMandateConsent(event.target.checked)} /><span>Otorgo el mandato especial y limitado para gestionar aclaraciones y reclamos administrativos de este caso, sin renunciar derechos ni recibir fondos.</span></label>
            <label className="contract-signer">Nombre completo para registrar la aceptación<input required value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Escribe tu nombre completo" autoComplete="name" /></label>
            {error && <p className="contract-error" role="alert">{error}</p>}
            <button className="portal-button portal-button-primary contract-submit" disabled={busy || !acceptedTerms || !dataConsent || !mandateConsent || signerName.trim().length < 3}>{busy ? "Guardando contrato…" : "Aceptar contrato y generar pago de prueba →"}</button>
          </form>}
        </div>
      </>}
    </section>
  </div>;
}

function PatientDocuments({ snapshot, deletingDocumentId, onAccount, onPam, onDelete }: { snapshot: Snapshot; deletingDocumentId: string; onAccount: () => void; onPam: () => void; onDelete: (document: CaseDocument) => void }) {
  return <section className="patient-card documents-view"><div className="card-heading"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h2>Fuentes cargadas</h2></div><div className="document-actions"><button className="portal-button portal-button-secondary" onClick={onAccount}>Agregar cuenta +</button><button className="portal-button portal-button-primary" onClick={onPam}>Agregar PAM +</button></div></div><div className="document-list">{snapshot.documents.map((doc) => <article className="patient-document clinic" key={doc.id}><span className="file-mark">PDF</span><div><span>{doc.classification}</span><b>{doc.name}</b><small>{doc.extraction?.pageCount || "-"} páginas · {processingLabel(doc)}</small>{doc.processingStatus === "review_required" && doc.sourceExpiresAt && <small>Original cifrado disponible temporalmente hasta {new Date(doc.sourceExpiresAt).toLocaleString("es-CL")}</small>}</div><div className="document-status"><em>{doc.processingStatus === "failed" ? "Requiere atención" : "Protegido"}</em><button className="patient-document-delete" onClick={() => onDelete(doc)} disabled={Boolean(deletingDocumentId)}>{deletingDocumentId === doc.id ? "Borrando…" : "Borrar documento"}</button></div></article>)}</div><div className="document-tip"><span>i</span><p>La cuenta muestra los cargos del prestador y el PAM la liquidación de cobertura. Cada documento mantiene su origen y estado de procesamiento.</p></div></section>;
}
function PatientActivity({ activities }: { activities: Activity[] }) {
  return <section className="patient-card activity-view"><span className="card-kicker">ACTIVIDAD</span><h2>Movimientos del expediente</h2><div className="activity-list">{activities.length ? activities.slice(0, 20).map((activity) => <div className={`activity-item ${activity.pending ? "pending" : ""}`} key={activity.id}><span className="activity-dot" /><div><small>{new Date(activity.date).toLocaleString("es-CL")}</small><b>{activity.title}</b><p>{activity.detail}</p></div></div>) : <div className="activity-item pending"><span className="activity-dot" /><div><small>Ahora</small><b>Esperando documentos</b><p>Los movimientos de carga, extracción, revisión y análisis aparecerán aquí.</p></div></div>}</div></section>;
}

function useCases() {
  const [cases, setCases] = useState<CaseRow[]>([]); const [error, setError] = useState("");
  const refresh = async () => { try {
    await fetch("/api/admin/pilot-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: PILOT_RESET_VERSION }) }).catch(() => undefined);
    const response = await fetch("/api/cases", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setCases(payload.cases || []);
  } catch (reason) { setError(errorMessage(reason, "No se pudieron cargar los casos")); } };
  useEffect(() => { void refresh(); }, []); return { cases, error, refresh };
}

function DeveloperEmpty({ error, onCreated }: { error?: string; onCreated: (caseId: string) => Promise<void> }) {
  const [patientName, setPatientName] = useState("");
  const [patientRun, setPatientRun] = useState("");
  const [episodeLabel, setEpisodeLabel] = useState("Revisión de cuenta clínica");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const id = crypto.randomUUID();
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, patientName: patientName || "Paciente", patientRun: normalizeChileanRun(patientRun), episodeLabel }),
      });
      if (!response.ok) throw new Error("No se pudo crear el expediente");
      await onCreated(id);
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo crear el expediente"));
    } finally {
      setBusy(false);
    }
  }

  return <main className="developer-empty-portal">
    <div className="developer-empty-glow developer-empty-glow-one" />
    <div className="developer-empty-glow developer-empty-glow-two" />
    <section className="developer-empty-shell">
      <header className="developer-empty-topbar">
        <PortalBrand className="dev-empty-brand"/>
        <div className="developer-empty-meta"><span className="surface-pill developer-pill">Vista desarrollador</span><span className="developer-empty-live"><i /> Entorno operativo</span></div>
      </header>
      <div className="developer-empty-content">
        <section className="developer-empty-copy">
          <p className="portal-kicker">CONSOLA DE DESARROLLO</p>
          <h1>Un expediente claro empieza aquí.</h1>
          <p className="developer-empty-lead">Crea el primer expediente del caso y carga sus documentos para iniciar una revisión trazable, línea por línea.</p>
          <div className="developer-empty-points">
            <div><span>01</span><div><b>Cuenta clínica primero</b><small>La fuente principal del análisis.</small></div></div>
            <div><span>02</span><div><b>Documentos separados</b><small>PAM, contrato y cuenta mantienen su origen.</small></div></div>
            <div><span>03</span><div><b>Hipótesis verificables</b><small>Cada resultado conserva página y evidencia pendiente.</small></div></div>
          </div>
        </section>
        <form className="developer-empty-card" onSubmit={submit}>
          <div className="developer-empty-card-top"><span className="card-kicker">NUEVO EXPEDIENTE</span><span className="developer-empty-step">PASO 01</span></div>
          <h2>Crear expediente operativo</h2>
          <p>Identifica el caso y luego podrás cargar la cuenta clínica, el PAM y el contrato.</p>
          <label>Nombre del paciente<input aria-label="Nombre del paciente" placeholder="Ej. Rafaella Rodríguez" value={patientName} onChange={(event) => setPatientName(event.target.value)} /></label>
          <label>RUN del paciente<input aria-label="RUN del paciente" inputMode="numeric" placeholder="12.345.678-9" value={patientRun} onChange={(event) => setPatientRun(event.target.value)} onBlur={() => setPatientRun(normalizeChileanRun(patientRun))} /></label>
          <label>Episodio o atención<input aria-label="Episodio" placeholder="Ej. Hospitalización pediátrica" value={episodeLabel} onChange={(event) => setEpisodeLabel(event.target.value)} /></label>
          {notice && <p className="developer-empty-error">{notice}</p>}
          <button className="portal-button portal-button-primary developer-empty-submit" disabled={busy}>{busy ? "Creando expediente…" : "Crear expediente y continuar"}<span>→</span></button>
          <div className="developer-empty-note"><span>i</span><small>El expediente comienza vacío. Ninguna cuenta se incorpora sin que la cargues.</small></div>
          <a className="developer-empty-patient-link" href="/?view=patient">Crear desde vista paciente <span>↗</span></a>
        </form>
      </div>
      <footer className="developer-empty-footer"><span>●</span> Estado sincronizado con el expediente <i /> Los documentos se incorporan sólo al ser cargados</footer>
    </section>
  </main>;
}

export function DeveloperPortal({ initialCaseId = "" }: { initialCaseId?: string }) {
  const auth = useAuthSession("developer");
  if (auth.loading) return <AuthenticationLoading />;
  if (!auth.user) return <DeveloperAccessUnavailable />;
  return <AuthenticatedDeveloperPortal initialCaseId={initialCaseId} user={auth.user} />;
}

function DeveloperNewCaseForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (caseId: string) => Promise<void> }) {
  const [patientName, setPatientName] = useState("");
  const [patientRun, setPatientRun] = useState("");
  const [episodeLabel, setEpisodeLabel] = useState("Revisión de cuenta clínica");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, patientName: patientName.trim() || "Paciente", patientRun: normalizeChileanRun(patientRun), episodeLabel: episodeLabel.trim() || "Revisión de cuenta clínica" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo crear el expediente");
      await onCreated(id);
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo crear el expediente"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="developer-new-case-panel">
    <div><span className="card-kicker">NUEVO EXPEDIENTE</span><h2>Probar otra cuenta</h2><p>Crea un expediente vacío para mantener cada cuenta aislada y comparar sus resultados.</p></div>
    <form onSubmit={submit} className="developer-new-case-form">
      <label>Nombre de referencia<input aria-label="Nombre del nuevo expediente" placeholder="Ej. Cuenta INDISA apendicitis" value={patientName} onChange={(event) => setPatientName(event.target.value)} /></label>
      <label>RUN del paciente<input aria-label="RUN del nuevo expediente" inputMode="numeric" placeholder="12.345.678-9" value={patientRun} onChange={(event) => setPatientRun(event.target.value)} onBlur={() => setPatientRun(normalizeChileanRun(patientRun))} /></label>
      <label>Episodio<input aria-label="Episodio del nuevo expediente" placeholder="Ej. Hospitalización / cirugía" value={episodeLabel} onChange={(event) => setEpisodeLabel(event.target.value)} /></label>
      {error && <p className="developer-empty-error">{error}</p>}
      <div className="developer-new-case-actions"><button type="button" className="portal-button portal-button-secondary" onClick={onCancel} disabled={busy}>Cancelar</button><button className="portal-button portal-button-primary" disabled={busy}>{busy ? "Creando…" : "Crear expediente"}</button></div>
    </form>
  </section>;
}

function AuthenticatedDeveloperPortal({ initialCaseId = "", user }: { initialCaseId?: string; user: SessionUser }) {
  const { cases, error: casesError, refresh: refreshCases } = useCases();
  const [selectedId, setSelectedId] = useState(initialCaseId);
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [tab, setTab] = useState<"overview" | "traceability" | "documents">("documents"); const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [newCaseOpen, setNewCaseOpen] = useState(false); const [pilotResetBusy, setPilotResetBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState("Esperando análisis");
  const [readerAssistBusy, setReaderAssistBusy] = useState(false);
  const [readerAssistResponse, setReaderAssistResponse] = useState<ReaderAssistResponse>();
  const [readerAssistDocumentId, setReaderAssistDocumentId] = useState("");
  const [visionAssistBusy, setVisionAssistBusy] = useState(false);
  const [visionAssistResponse, setVisionAssistResponse] = useState<VisionAssistResponse>();
  const [visionAssistDocumentId, setVisionAssistDocumentId] = useState("");
  const sourceFileRef = useRef<{ documentId: string; file: File }>();
  const [pendingUpload, setPendingUpload] = useState<PendingUpload>();
  // A clean developer entry must never open an existing case implicitly.
  // Cases remain available through an explicit `?case=` link or by creating a
  // new expediente from the empty console.
  const selected = cases.some((item) => item.id === selectedId) ? selectedId : "";
  async function refresh() { if (!selected) return; try { const next = hideStaleAnalysis(await getSnapshot(selected)); setSnapshot(next); if (extractionNeedsRefresh(accountDoc(next))) setNotice("La extracción anterior quedó fuera de vigencia. Reemplaza la cuenta clínica para aplicar el lector actualizado."); } catch (reason) { setNotice(errorMessage(reason, "No se pudo cargar el expediente")); } }
  useEffect(() => { void refresh(); }, [selected]);
  async function clearPilotConsole() {
    if (!window.confirm("¿Vaciar la consola piloto? Se eliminarán los casos, documentos y análisis antiguos de Railway; el corpus validado se conserva.")) return;
    setPilotResetBusy(true);
    try {
      const response = await fetch("/api/admin/pilot-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: PILOT_RESET_VERSION }) });
      const payload = await response.json().catch(() => ({})) as { reset?: boolean; deletedCases?: number; deletedDocuments?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo vaciar la consola");
      setSelectedId("");
      setSnapshot(undefined);
      setNotice(payload.reset ? `Consola vaciada: ${payload.deletedCases || 0} expedientes y ${payload.deletedDocuments || 0} documentos eliminados.` : "La consola ya estaba vacía.");
      await refreshCases();
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo vaciar la consola"));
    } finally {
      setPilotResetBusy(false);
    }
  }
  async function onFile(file: File, classification: string) {
    if (!selected) return;
    const previousAccount = /cuenta|mixto/i.test(classification) ? accountDoc(snapshot) : undefined;
    setBusy(true);
    setPendingUpload({ name: file.name, classification });
    setUploadProgress(2);
    setUploadStage(/pam|liquid/i.test(classification) ? "Preparando lectura del PAM / liquidación" : /contrato|plan/i.test(classification) ? "Preparando lectura del contrato / plan" : "Preparando lector PDF / OCR");
    setAnalysisStatus("idle");
    setReaderAssistResponse(undefined);
    setReaderAssistDocumentId("");
    setVisionAssistResponse(undefined);
    setVisionAssistDocumentId("");
    try {
      const documentLabel = /pam|liquid/i.test(classification) ? "PAM / liquidación" : /contrato|plan/i.test(classification) ? "contrato / plan" : "cuenta clínica";
      const updateProgress = (value: number) => {
        const bounded = Math.max(2, Math.min(100, Math.round(value)));
        setUploadProgress(bounded);
        setUploadStage(
          bounded <= 2
            ? `Preparando lector PDF / OCR`
            : bounded >= 100
              ? `Lectura de ${documentLabel} completada`
              : `Leyendo ${documentLabel}`,
        );
      };
      let result = previousAccount
        ? await replaceAccountDocument(selected, previousAccount, file, updateProgress)
        : await uploadDocument(selected, file, classification, updateProgress);
      let automaticVisionNotice = "";
      if (/cuenta|mixto/i.test(classification)) {
        sourceFileRef.current = { documentId: result.documentId, file };
        if (shouldAutoVision(result.extraction)) {
          setVisionAssistBusy(true);
          setUploadProgress(3);
          setUploadStage("OCR bajo detectado · preparando zonas para GPT Vision");
          try {
            const vision = await requestVisionReview(selected, { id: result.documentId, caseId: selected, name: file.name, mimeType: file.type }, result.extraction, file, (value) => {
              setUploadProgress(value);
              setUploadStage(value >= 100 ? "Propuesta GPT Vision disponible" : value < 60 ? `Preparando zonas para GPT Vision · ${value}%` : "Consultando GPT Vision");
            });
            setVisionAssistResponse(vision);
            setVisionAssistDocumentId(result.documentId);
            const merged = mergeVisionCorrections(result.extraction, vision);
            if (merged.appliedCount > 0) {
              await persistExtraction(result.documentId, merged.extraction);
              result = { ...result, extraction: merged.extraction };
            }
            automaticVisionNotice = vision.status === "ready_for_review"
              ? `OCR bajo detectado: GPT Vision revisó las zonas y aplicó ${merged.appliedCount} corrección(es) de alta confianza con trazabilidad.`
              : "OCR bajo detectado: GPT Vision no encontró evidencia suficiente; la cuenta quedó pendiente de revisión humana.";
          } catch (reason) {
            automaticVisionNotice = `La cuenta fue guardada, pero la revisión visual automática quedó pendiente: ${errorMessage(reason, "no se pudo consultar GPT Vision")}`;
          } finally {
            setVisionAssistBusy(false);
          }
        }
      }
      await refresh();
      await refreshCases();
      setNotice(automaticVisionNotice || (previousAccount
        ? "Cuenta clínica anterior eliminada y reemplazada correctamente"
        : result.corpusRegistered
          ? "Documento guardado, extraído y enviado a revisión de aprendizaje"
          : "Documento guardado y extraído; el aprendizaje quedó pendiente de sincronización"));
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo procesar el documento"));
      await refresh();
      await refreshCases();
    }
    finally { setBusy(false); setUploadStage(""); setPendingUpload(undefined); }
  }
  async function onAnalyze() {
    if (!snapshot) return;
    setBusy(true);
    setAnalysisStatus("running");
    setAnalysisProgress(8);
    setAnalysisStage("Preparando la cuenta");
    let simulatedProgress = 8;
    const timer = window.setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + 7, 88);
      setAnalysisProgress(simulatedProgress);
      setAnalysisStage(simulatedProgress < 35 ? "Ordenando las líneas" : simulatedProgress < 65 ? "Revisando los cargos" : "Preparando la matriz");
    }, 180);
    try {
      const analysis = await analyzeCase(selected, accountDoc(snapshot), snapshot.case.episodeLabel);
      setSnapshot((current) => current ? {
        ...current,
        analysis,
        case: { ...current.case, status: "analysis_ready", updatedAt: new Date().toISOString() },
      } : current);
      setAnalysisProgress(100);
      setAnalysisStage("Resultado disponible para revisión");
      setAnalysisStatus("complete");
      await refresh(); await refreshCases(); setTab("traceability");
      setNotice("Análisis guardado; la observación quedó pendiente de revisión de corpus");
    } catch (reason) { setAnalysisStatus("error"); setNotice(errorMessage(reason, "No se pudo analizar el caso")); }
    finally { window.clearInterval(timer); setBusy(false); }
  }
  async function onRetryReader() {
    const document = accountDoc(snapshot);
    if (!selected || !document || document.sourceDeletedAt) {
      setNotice("El original temporal ya no está disponible; reemplaza la cuenta para volver a leerla.");
      return;
    }
    setBusy(true);
    setUploadProgress(2);
    setUploadStage("Reintentando lectura con el lector PDF compatible");
    setAnalysisStatus("idle");
    setReaderAssistResponse(undefined);
    setReaderAssistDocumentId("");
    setVisionAssistResponse(undefined);
    setVisionAssistDocumentId("");
    try {
      const updateProgress = (value: number) => {
        const bounded = Math.max(2, Math.min(100, Math.round(value)));
        setUploadProgress(bounded);
        setUploadStage(bounded >= 100 ? "Relectura completada" : "Reintentando lectura con el lector PDF compatible");
      };
      let result = await retryStoredDocument(selected, document, updateProgress);
      let automaticVisionNotice = "";
      if (shouldAutoVision(result.extraction)) {
        setVisionAssistBusy(true);
        setUploadProgress(3);
        setUploadStage("OCR bajo detectado · preparando zonas para GPT Vision");
        try {
          const vision = await requestVisionReview(selected, document, result.extraction, undefined, (value) => {
            setUploadProgress(value);
            setUploadStage(value >= 100 ? "Propuesta GPT Vision disponible" : value < 60 ? `Preparando zonas para GPT Vision · ${value}%` : "Consultando GPT Vision");
          });
          setVisionAssistResponse(vision);
          setVisionAssistDocumentId(document.id);
          const merged = mergeVisionCorrections(result.extraction, vision);
          if (merged.appliedCount > 0) {
            await persistExtraction(document.id, merged.extraction);
            result = { ...result, extraction: merged.extraction };
          }
          automaticVisionNotice = vision.status === "ready_for_review"
            ? `La cuenta fue releída y GPT Vision aplicó ${merged.appliedCount} corrección(es) de alta confianza con trazabilidad.`
            : "La cuenta fue releída, pero GPT Vision no encontró evidencia suficiente; quedó pendiente de revisión humana.";
        } catch (reason) {
          automaticVisionNotice = `La cuenta fue releída, pero la revisión visual automática quedó pendiente: ${errorMessage(reason, "no se pudo consultar GPT Vision")}`;
        } finally {
          setVisionAssistBusy(false);
        }
      }
      await refresh();
      await refreshCases();
      setNotice(automaticVisionNotice || "La cuenta fue releída desde el original temporal; no fue necesario volver a subirla.");
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo reintentar la lectura"));
      await refresh();
      await refreshCases();
    } finally {
      setBusy(false);
      setUploadStage("");
    }
  }
  async function onReaderAssist() {
    if (!snapshot) return;
    const account = accountDoc(snapshot);
    if (!account?.extraction) {
      setNotice("La asistencia LLM necesita una extracción parcial con evidencia; conserva el original para revisión humana u OCR adicional.");
      return;
    }
    setReaderAssistBusy(true);
    setReaderAssistResponse(undefined);
    try {
      const response = await fetch("/api/reader-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId: selected, documentId: account.id, expectedKind: "account", extraction: account.extraction }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo solicitar asistencia LLM");
      setReaderAssistResponse(payload as ReaderAssistResponse);
      setReaderAssistDocumentId(account.id);
      setNotice(payload.status === "ready_for_review" ? "La asistencia LLM quedó disponible para revisión humana; no se aplicó automáticamente." : "La asistencia LLM no encontró evidencia suficiente; la cuenta requiere revisión humana.");
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo solicitar asistencia LLM"));
    } finally {
      setReaderAssistBusy(false);
    }
  }
  async function onVisionAssist() {
    if (!snapshot) return;
    const account = accountDoc(snapshot);
    if (!account) {
      setNotice("GPT Vision necesita una cuenta clínica registrada en el expediente.");
      return;
    }
    if (account.sourceDeletedAt) {
      setNotice("El original temporal ya no está disponible para GPT Vision. Reemplaza la cuenta para preparar una nueva lectura visual.");
      return;
    }
    const extraction = account.extraction ?? emptyVisionExtraction();
    setBusy(true);
    setVisionAssistBusy(true);
    setVisionAssistResponse(undefined);
    setVisionAssistDocumentId("");
    setUploadProgress(3);
    setUploadStage("Preparando páginas para GPT Vision");
    try {
      const vision = await requestVisionReview(selected, account, extraction, sourceFileRef.current?.documentId === account.id ? sourceFileRef.current.file : undefined, (value) => {
        setUploadProgress(value);
        setUploadStage(value >= 100 ? "Propuesta GPT Vision disponible" : value < 60 ? `Preparando zonas para GPT Vision · ${value}%` : "Consultando GPT Vision");
      });
      setVisionAssistResponse(vision);
      setVisionAssistDocumentId(account.id);
      const merged = mergeVisionCorrections(extraction, vision);
      if (merged.appliedCount > 0) {
        await persistExtraction(account.id, merged.extraction);
        await refresh();
      }
      setNotice(vision.status === "ready_for_review"
        ? `GPT Vision terminó: ${merged.appliedCount} corrección(es) de alta confianza fueron incorporadas con sus valores originales conservados.`
        : "GPT Vision no encontró evidencia suficiente; la cuenta requiere revisión humana.");
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo solicitar GPT Vision"));
    } finally {
      setVisionAssistBusy(false);
      setBusy(false);
      setUploadStage("");
    }
  }
  async function onCorpusStatus(status: "pending_review" | "validated" | "rejected") { if (!selected) return; setBusy(true); try { const response = await fetch(`/api/cases/${encodeURIComponent(selected)}/corpus`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el corpus"); await refresh(); setNotice(payload.message || "Estado del corpus actualizado"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo actualizar el corpus")); } finally { setBusy(false); } }
  const visibleCases = useMemo(() => cases.filter((item) => `${item.patient_name} ${item.patient_run || ""} ${item.id} ${item.episode_label}`.toLowerCase().includes(query.toLowerCase())), [cases, query]);
  if (!selected) return <DeveloperEmpty error={casesError} onCreated={async (id) => { setSelectedId(id); await refreshCases(); }} />;
  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const total = totalFrom(account, "account");
  return <main className="developer-portal"><aside className="developer-sidebar"><PortalBrand href="/" className="dev-brand"/><div className="dev-workspace-label">ESPACIO DE TRABAJO</div><nav className="dev-nav"><a className="active" href="/?view=developer"><span>▦</span> Expedientes <em>{cases.length}</em></a><a href="#rules"><span>◌</span> Reglas del motor</a><a href="#corpus"><span>⌁</span> Corpus observado</a></nav><div className="dev-sidebar-bottom"><a href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer"><span>↗</span> Vista paciente</a><div className="dev-user"><span className="avatar">DEV</span><div><b>Desarrollador</b><small>{user.email}</small></div></div></div></aside><section className="developer-main"><header className="developer-header"><div><p className="portal-kicker">CONSOLA DE DESARROLLO</p><h1>Expedientes</h1><p>Revisión técnica sobre documentos protegidos y asociados a su propietario.</p></div><div className="developer-header-actions"><span className="surface-pill developer-pill">Vista desarrollador</span><button className="portal-button portal-button-primary" onClick={() => setNewCaseOpen((open) => !open)}>{newCaseOpen ? "Cerrar nuevo expediente" : "Nuevo expediente +"}</button><button className="portal-button portal-button-secondary" onClick={() => void clearPilotConsole()} disabled={pilotResetBusy}>{pilotResetBusy ? "Vaciando…" : "Vaciar consola piloto"}</button><a className="portal-button portal-button-secondary" href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer">Abrir vista paciente ↗</a><a className="patient-signout-button" href={signOutHref(user)}>Cerrar sesión</a></div></header><div className="developer-body">{newCaseOpen && <DeveloperNewCaseForm onCancel={() => setNewCaseOpen(false)} onCreated={async (id) => { setNewCaseOpen(false); setSelectedId(id); await refreshCases(); }} />}<section className="case-queue"><div className="queue-header"><div><span className="card-kicker">BANDEJA DE CASOS</span><h2>Casos recientes <em>{cases.length}</em></h2></div></div><div className="queue-search">⌕ <input placeholder="Buscar paciente, cuenta o episodio" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="queue-list">{visibleCases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`dev-case-row ${selected === item.id ? "active" : ""}`}><span className="avatar">{item.patient_name.slice(0, 2).toUpperCase()}</span><div><b>{selected === item.id && snapshot ? patientNameForDeveloper(snapshot) : item.patient_name}</b><small>{item.id} · {item.document_count} documentos</small></div><em className={item.status.includes("analysis") ? "green" : "blue"}>{item.status}</em></button>)}</div></section><section className="case-detail"><div className="case-detail-head"><div><span className="case-breadcrumb">EXPEDIENTE / {selected}</span><h2>{snapshot ? patientNameForDeveloper(snapshot) : "Cargando…"}</h2><p>{snapshot?.case.episodeLabel || ""}</p></div><span className="case-state"><i /> {snapshot?.case.status || "Cargando"}</span></div>{snapshot && <><div className="dev-summary-metrics"><DevMetric label="Cuenta clínica" value={money(total)} detail="Documento base"/><DevMetric label="Desfragmentación" value={snapshot.analysis ? `${snapshot.analysis.lineAssessments.length} líneas` : "Pendiente"} detail="Hipótesis técnicas" pending={!snapshot.analysis}/><DevMetric label="Contexto PAM" value={pam ? "Recibido" : "Pendiente"} detail="Se conserva separado" pending={!pam}/><DevMetric label="Autorización" value={snapshot.authorization?.authorized ? "Otorgada" : "Pendiente"} detail="Gestión de reclamos" pending={!snapshot.authorization?.authorized}/><DevMetric label="Documentos" value={String(snapshot.documents.length)} detail="Fuentes del caso"/></div><div className="dev-tabs">{(["overview", "traceability", "documents"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "overview" ? "Resumen" : item === "traceability" ? "Matriz de trazabilidad" : "Documentos"}</button>)}</div>{notice && <p className="patient-analysis-notice">{notice}</p>}{uploadStage && <UploadProgress progress={uploadProgress} stage={uploadStage} />}{analysisStatus === "running" && <AnalysisProgress progress={analysisProgress} stage={analysisStage} />}{tab === "overview" && <DeveloperOverview snapshot={snapshot} total={total} busy={busy} onAnalyze={() => void onAnalyze()} onExport={() => downloadJson(`${selected}-preinforme.json`, snapshot)} onClaimDraft={() => downloadClaim(`${selected}-solicitud-aclaracion.md`, snapshot)} onCorpusStatus={onCorpusStatus} />}{tab === "traceability" && <DeveloperTraceability snapshot={snapshot} onExport={() => downloadJson(`${selected}-matriz.json`, snapshot.analysis)} onExportMarkdown={() => snapshot.analysis && downloadMarkdown(`${selected}-matriz.md`, snapshot.analysis)} />}{tab === "documents" && <DeveloperDocuments snapshot={snapshot} busy={busy} pendingUpload={pendingUpload} uploadProgress={uploadProgress} uploadStage={uploadStage} onFile={(file, kind) => void onFile(file, kind)} onAnalyze={() => void onAnalyze()} onRetryReader={() => void onRetryReader()} readerAssistBusy={readerAssistBusy} readerAssistResponse={readerAssistDocumentId === account?.id ? readerAssistResponse : undefined} onReaderAssist={() => void onReaderAssist()} visionAssistBusy={visionAssistBusy} visionAssistResponse={visionAssistDocumentId === account?.id ? visionAssistResponse : undefined} onVisionAssist={() => void onVisionAssist()} />}</>}</section></div></section></main>;
}

function DeveloperCaseIdentity({ snapshot }: { snapshot: Snapshot }) {
  const account = accountDoc(snapshot);
  const patient = accountField(snapshot, /^(?:patient|paciente)\b/i);
  const rut = accountField(snapshot, /patient_rut|rut/i);
  const provider = accountField(snapshot, /provider|prestador|cl[ií]nica|hospital/i);
  const accountNumber = accountField(snapshot, /account_number|n[uú]mero de cuenta|folio/i);
  const identityRows = [
    { label: "Paciente registrado", value: patientNameForDeveloper(snapshot), source: patient ? `Cuenta clínica · pág. ${patient.page}` : "Datos del expediente" },
    { label: "RUN del paciente", value: snapshot.case.patientRun || rut?.value || "No informado", source: snapshot.case.patientRun ? "Informado por el paciente" : rut ? `Cuenta clínica · pág. ${rut.page}` : "Requiere revisión del documento" },
    { label: "Correo de contacto", value: snapshot.case.contactEmail || "No informado", source: "Datos del expediente" },
    { label: "Clínica / prestador", value: provider?.value || "No identificado en la cuenta", source: provider ? `Cuenta clínica · pág. ${provider.page}` : "Requiere revisión del documento" },
    { label: "Cuenta / ingreso", value: accountNumber?.value || snapshot.case.id, source: accountNumber ? `Cuenta clínica · pág. ${accountNumber.page}` : "ID del expediente" },
    { label: "Episodio", value: snapshot.case.episodeLabel, source: "Datos del expediente" },
  ];
  return <section className="developer-identity-panel"><div className="developer-identity-head"><div><span className="card-kicker">IDENTIFICACIÓN DEL EXPEDIENTE</span><h3>¿De quién es esta cuenta?</h3><p>Datos de identificación para asociar la cuenta al paciente y al prestador correcto.</p></div><span className="developer-identity-badge">Uso interno</span></div><div className="developer-identity-grid">{identityRows.map((row) => <article key={row.label}><span>{row.label}</span><strong>{row.value}</strong><small>{row.source}</small></article>)}</div><p className="developer-identity-note"><b>Fuente:</b> {account ? `${account.name}.` : "La cuenta clínica todavía no está cargada."} Los campos se muestran sólo si fueron informados o extraídos; no se completan por inferencia. Este bloque es exclusivo de la consola de desarrollo y no se expone en la vista paciente.</p></section>;
}

function DevMetric({ label, value, detail, pending }: { label: string; value: string; detail: string; pending?: boolean }) { return <article className={`dev-metric ${pending ? "pending" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function DeveloperOverview({ snapshot, total, busy, onAnalyze, onExport, onClaimDraft, onCorpusStatus }: { snapshot: Snapshot; total: number; busy: boolean; onAnalyze: () => void; onExport: () => void; onClaimDraft: () => void; onCorpusStatus: (status: "pending_review" | "validated" | "rejected") => void }) { const account = accountDoc(snapshot); const analysis = snapshot.analysis; const candidates = analysis?.lineAssessments.filter((item) => Boolean(bestCombinedCandidate(analysis, item))) || []; return <div className="developer-overview"><DeveloperCaseIdentity snapshot={snapshot}/><div className="dev-flow-card"><div className="card-heading"><div><span className="card-kicker">FLUJO DEL EXPEDIENTE</span><h3>Cuenta clínica primero</h3></div><span className="dev-percentage">{analysis ? "100%" : "50%"}</span></div><div className="dev-flow"><FlowStep number="01" title="Cuenta" state={account ? "complete" : "pending"} detail={account ? "Recibida" : "Pendiente"}/><i/><FlowStep number="02" title="Análisis de cuenta" state={analysis ? "complete" : account ? "current" : "pending"} detail={analysis ? "Listo" : account ? "En curso" : "Esperando cuenta"}/><i/><FlowStep number="03" title="Cobertura PAM" state={pamDoc(snapshot) ? "complete" : "pending"} detail={pamDoc(snapshot) ? "Aislada" : "Opcional"}/><i/><FlowStep number="04" title="Conciliación posterior" state="pending" detail="No ejecutada"/></div></div><div className="developer-scope-card"><div><span className="card-kicker">ALCANCE ACTUAL</span><h3>Posibles desfragmentaciones del prestador</h3><p>Se revisan glosas, códigos, cantidades y vínculos dentro de la cuenta clínica. El PAM informa cobertura, bonificación, copago y rechazos; no determina desfragmentaciones ni reemplaza la cuenta.</p></div><span>OPERATIVO</span></div><div className="dev-analysis-grid"><article><span className="card-kicker">CUENTA CLÍNICA</span><strong>{money(total)}</strong><small>Total informado por el prestador</small></article><article><span className="card-kicker">LÍNEAS CANDIDATAS</span><strong>{candidates.length}</strong><small>Reglas y segunda lectura LLM</small></article><article><span className="card-kicker">PRÓXIMA ACCIÓN</span><strong>{analysis ? "Exportar" : "Analizar"}</strong><small>{analysis ? "Preinforme del caso" : "Ejecutar motor + LLM"}</small></article></div><div className="developer-actions"><button className="portal-button portal-button-primary" onClick={onAnalyze} disabled={busy}>{busy ? "Procesando…" : analysis ? "Actualizar análisis" : "Abrir analizador"} →</button><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar preinforme</button><button className="portal-button portal-button-secondary" onClick={onClaimDraft}>Generar reclamo base</button></div><CorpusLearningPanel status={snapshot.corpusStatus} busy={busy} onStatus={onCorpusStatus}/>{analysis && <DeveloperAnalysisDetail analysis={analysis}/>}</div>; }
function CorpusLearningPanel({ status, busy, onStatus }: { status?: Snapshot["corpusStatus"]; busy: boolean; onStatus: (status: "pending_review" | "validated" | "rejected") => void }) { const label = status === "validated" ? "Activo en corpus" : status === "rejected" ? "No incorporado" : status === "pending_review" ? "Pendiente de validación" : "Sin observación registrada"; return <section className="corpus-learning-panel"><div><span className="card-kicker">APRENDIZAJE INCREMENTAL</span><h3>{label}</h3><p>Las observaciones de cuenta y PAM se registran por separado. Solo una revisión humana las incorpora al corpus correspondiente.</p></div><div className="corpus-learning-actions"><button className="portal-button portal-button-secondary" onClick={() => onStatus("validated")} disabled={busy || status === "validated"}>Validar aporte</button><button className="portal-button portal-button-secondary" onClick={() => onStatus("rejected")} disabled={busy || status === "rejected"}>Rechazar</button></div></section>; }

function DeveloperTraceability({ snapshot, onExport, onExportMarkdown }: { snapshot: Snapshot; onExport: () => void; onExportMarkdown: () => void }) { return <div className="traceability-view"><DeveloperCaseIdentity snapshot={snapshot}/><div className="traceability-toolbar"><div><span className="card-kicker">MATRIZ DE CUENTA CLÍNICA</span><h3>Evidencia línea por línea</h3></div><div className="traceability-toolbar-actions"><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar .json</button><button className="portal-button portal-button-secondary" onClick={onExportMarkdown}>Exportar .md</button></div></div>{snapshot.analysis ? <DeveloperAnalysisDetail analysis={snapshot.analysis}/> : <section className="trace-note"><span>i</span><p>Ejecuta el análisis desde Resumen para generar la matriz.</p></section>}</div>; }
function PrecedentProjectionPanel({ analysis, rows }: { analysis: ClinicalAccountAnalysis; rows: ClinicalAccountAnalysis["lineAssessments"] }) {
  const equality = analysis.equalityProjection ?? EQUALITY_PROJECTION_FRAMEWORK;
  const comparisons = rows.flatMap((item) => (item.precedentComparisons ?? []).map((comparison) => ({ item, comparison })));
  if (!comparisons.length) return null;
  const strongCount = comparisons.filter(({ comparison }) => comparison.status === "strong_comparator").length;
  return <section className="precedent-projection-panel"><div className="precedent-projection-head"><div><span className="card-kicker">PROYECCIÓN JURÍDICA CONTROLADA</span><h3>Antecedentes y expansiones de la sentencia</h3><p>{equality.precedentRole}</p></div><div className="developer-analysis-badges"><span>{strongCount} comparables fuertes</span><span>{comparisons.length} líneas relacionadas</span></div></div><div className="precedent-projection-summary"><strong>{equality.constitutionalBasis}</strong><p>{equality.projectionRule}</p></div><div className="precedent-projection-list">{comparisons.slice(0, 12).map(({ item, comparison }) => { const outcomeLabel = comparison.outcomeLabel || bundleLabel(comparison.outcomeBundle); return <article key={`${item.line.id}-${comparison.precedentId}`}><div><b>{item.line.description}</b><small>{comparison.label} · {Math.round(comparison.comparability * 100)}% de comparabilidad</small></div><span className={`${comparison.status === "strong_comparator" ? "strong" : "partial"} ${comparison.outcome === "excluded" ? "excluded" : ""}`}>{comparison.outcome === "excluded" ? outcomeLabel : comparison.status === "strong_comparator" ? `Incluido en ${outcomeLabel}` : `Comparación parcial · ${outcomeLabel}`}</span><p>{comparison.explanation}</p><small className="precedent-factors">{comparison.matchedFactors.join(" · ")}</small>{comparison.distinctionFactors.length > 0 && <small className="precedent-distinction">Diferencia a justificar: {comparison.distinctionFactors.join(" · ")}</small>}</article>; })}</div><p className="developer-detail-foot">La sentencia no se redujo al termómetro: separó medicamento hospitalizado, Día Cama, Derecho de Pabellón y un artículo personal sin cobertura en ese caso. Cada resultado se proyecta de forma independiente y no reemplaza contrato, convenio, registro de uso ni homologación.</p></section>;
}

function ReasoningControlPanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const findings = (analysis.reasoningFindings ?? []).filter((finding) => finding.status !== "not_triggered");
  if (!findings.length) return null;
  return <section className="reasoning-control-panel"><div className="precedent-projection-head"><div><span className="card-kicker">JURISPRUDENCIA Y COMPENDIOS</span><h3>Controles que amplían la lectura</h3><p>El motor transforma las conclusiones en solicitudes de evidencia y pasos de revisión.</p></div><div className="developer-analysis-badges"><span>{findings.length} controles activos</span></div></div><div className="reasoning-control-list">{findings.map((finding) => <article key={finding.id}><div className="reasoning-control-title"><span className={`reasoning-status ${finding.status}`}>{finding.status === "relevant" ? "Activado" : "Falta evidencia"}</span><b>{finding.title}</b></div><p>{finding.explanation}</p><small><strong>Acción:</strong> {finding.action}</small><small><strong>Fuentes:</strong> {finding.sourceReferences.join(" · ")}</small></article>)}</div></section>;
}

function DeveloperBreakdownPanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const breakdown = buildDeveloperBreakdown(analysis);
  if (!breakdown.pavilionRows.length && !breakdown.alternatives.length) return null;
  return <section className="developer-breakdown-panel">
    <div className="developer-breakdown-head">
      <div>
        <span className="card-kicker">RESULTADO CLASIFICADO DEL MOTOR</span>
        <h3>Posibles desfragmentaciones por rubro</h3>
        <p>Las sumas son líneas únicas bajo hipótesis técnicas. No equivalen a una devolución ni reemplazan contrato, registro de uso o decisión de la autoridad.</p>
      </div>
      <div className="developer-breakdown-total"><small>Monto único en revisión</small><strong>{money(breakdown.uniqueCandidateAmount)}</strong></div>
    </div>
    <div className="developer-breakdown-summary">
      <div><b>{money(breakdown.pavilionAmount)}</b><small>Posibles componentes de pabellón</small></div>
      <div><b>{breakdown.pavilionRows.length}</b><small>Líneas candidatas de pabellón</small></div>
      <div><b>{breakdown.zeroCount}</b><small>Líneas con valor cero</small></div>
      <div><b>{breakdown.categories.length}</b><small>Rúbricas técnicas</small></div>
    </div>
    <div className="developer-breakdown-category-table">
      <div className="developer-breakdown-category-head"><span>Clasificación técnica</span><span>Líneas</span><span>En cero</span><span>Subtotal</span></div>
      {breakdown.categories.map((category) => <div className="developer-breakdown-category-row" key={category.key}><b>{category.label}</b><span>{category.count}</span><span>{category.zeroCount}</span><strong>{money(category.amount)}</strong></div>)}
      <div className="developer-breakdown-category-row total"><b>Total posible pabellón</b><span>{breakdown.pavilionRows.length}</span><span>{breakdown.zeroCount}</span><strong>{money(breakdown.pavilionAmount)}</strong></div>
    </div>
    <div className="developer-breakdown-groups">
      {breakdown.categories.map((category) => <section key={category.key}>
        <div className="developer-breakdown-group-head"><div><b>{category.label}</b><small>{category.count} líneas · {category.zeroCount} sin cargo</small></div><strong>{money(category.amount)}</strong></div>
        <div className="developer-breakdown-item-list">
          {category.items.map((item) => <article key={`${category.key}-${item.code}-${item.description}`}><div><b>{item.description}</b><small>{item.code} · {item.count} línea{item.count === 1 ? "" : "s"} · {Math.round(item.probability * 100)}%</small></div><strong>{money(item.amount)}</strong></article>)}
        </div>
      </section>)}
    </div>
    {breakdown.alternatives.length > 0 && <div className="developer-breakdown-alternatives"><div><span className="card-kicker">RUTAS ALTERNATIVAS</span><b>Se muestran aparte para evitar doble conteo</b></div>{breakdown.alternatives.map(({ line, candidate, overlapsPavilion }) => <article key={`${line.id}-${candidate.bundle}`}><div><b>{line.description}</b><small>{bundleLabel(candidate.bundle)} · {Math.round(candidate.probability * 100)}% · {line.code || "sin código"}</small></div><strong>{money(line.amount)}</strong><span>{overlapsPavilion ? "Ya incluido como alternativa en el subtotal de pabellón" : "Se incorpora al monto único"}</span></article>)}</div>}
    <p className="developer-breakdown-note">El procedimiento principal y los honorarios no se suman como desfragmentación. Los sueros fisiológicos se mantienen pendientes de registro de administración y contrato; un componente puede tener más de una ruta funcional.</p>
  </section>;
}

function LlmSecondReaderPanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const assist = analysis.llmAssist;
  if (!assist) return null;
  const reviewHypotheses = assist.lineHypotheses.filter((item) => item.decision === "review" && item.confidence >= LLM_CANDIDATE_THRESHOLD);
  const episodeLabel = assist.episode.type === "surgical"
    ? "Episodio quirúrgico"
    : assist.episode.type === "hospitalization"
      ? "Hospitalización"
      : assist.episode.type === "emergency"
        ? "Urgencia"
        : assist.episode.type === "mixed"
          ? "Episodio mixto"
          : assist.episode.type === "ambulatory"
            ? "Atención ambulatoria"
            : "Contexto no resuelto";
  const statusLabel = assist.status === "ready_for_review"
    ? "Segunda lectura disponible"
    : assist.status === "not_configured"
      ? "API no configurada"
      : assist.status === "unavailable"
        ? "Asistencia temporalmente no disponible"
        : "Evidencia insuficiente";
  return <section className="reader-assist-panel llm-analysis-panel">
    <div className="reader-assist-head"><div><span className="card-kicker">SEGUNDA LECTURA LLM</span><h3>{statusLabel}</h3><p>{assist.summary}</p></div><span className="reader-assist-badge">{assist.model || "Sin modelo"}</span></div>
    <div className="developer-detail-metrics"><article><b>{episodeLabel}</b><small>Contexto clínico propuesto</small></article><article><b>{assist.episode.hasOperatingRoom ? "Sí" : "No / dudoso"}</b><small>Pabellón reconocido</small></article><article><b>{reviewHypotheses.length}</b><small>Hipótesis sobre 70%</small></article><article><b>{assist.episode.anchors.length}</b><small>Anclas trazables</small></article></div>
    {assist.episode.anchors.length > 0 && <div className="reader-quality-signals"><b>Anclas del episodio</b>{assist.episode.anchors.slice(0, 8).map((anchor) => <span key={`${anchor.lineId}-${anchor.page}`}>Pág. {anchor.page}: {anchor.evidence}</span>)}</div>}
    {assist.warnings.length > 0 && <div className="reader-assist-notes">{assist.warnings.map((warning) => <small key={warning}>• {warning}</small>)}</div>}
    <p className="developer-detail-foot">Las hipótesis LLM se muestran y suman sólo desde 70% de confianza. Siguen siendo presuntivas y requieren contraste con cuenta, contrato, registro de uso y respuesta del prestador.</p>
  </section>;
}

function OperatingRoomScopePanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const framework = analysis.operatingRoomFramework ?? FULL_OPERATING_ROOM_FRAMEWORK;
  const active = analysis.lineAssessments.some((item) => Boolean(bestCombinedCandidate(analysis, item, "operating_room")))
    || analysis.llmAssist?.episode.hasOperatingRoom === true;
  if (!active) return null;
  return <section className="reasoning-control-panel"><div className="precedent-projection-head"><div><span className="card-kicker">CIRCULAR 43 · FULL PABELLÓN</span><h3>Alcance integral activado</h3><p>{framework.sourceRule}</p></div><div className="developer-analysis-badges"><span>{framework.includedCategories.length} categorías</span></div></div><div className="functional-equivalence-summary"><strong>Regla operativa</strong><p>{framework.applicationRule}</p></div><div className="reasoning-control-list">{framework.includedCategories.map((category) => <article key={category}><b>{category}</b></article>)}</div><p className="developer-detail-foot">{framework.limits.join(" ")}</p></section>;
}

function FunctionalEquivalencePanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const alerts = analysis.functionalEquivalenceAlerts ?? [];
  if (!alerts.length) return null;
  const visibleAlerts = alerts.slice(0, 24);
  return <section className="functional-equivalence-panel"><div className="precedent-projection-head"><div><span className="card-kicker">CORPUS UNIVERSAL DE CUENTAS</span><h3>Alertas por equivalencia funcional</h3><p>Productos similares por función clínica, aunque cambien la marca, el calibre, la presentación o la glosa.</p></div><div className="developer-analysis-badges"><span>{alerts.length} alertas</span><span>{alerts.filter((alert) => alert.alertLevel === "high").length} altas</span></div></div><div className="functional-equivalence-summary"><strong>Cómo leerlas</strong><p>La alerta levanta una ruta de revisión. No suma montos ni afirma que el producto pertenezca a Día Cama, Medicamentos Hospitalizados o Pabellón sin contrato, registro de uso y confirmación del caso.</p></div><div className="functional-equivalence-list">{visibleAlerts.map((alert) => <article key={`${alert.lineId}-${alert.familyId}`}><div className="functional-equivalence-title"><div><b>{alert.lineDescription}</b><small>{alert.familyLabel}</small></div><span className={`functional-alert-level ${alert.alertLevel}`}>{functionalAlertLevelLabel(alert.alertLevel)} · {Math.round(alert.comparability * 100)}%</span></div><p><strong>Destino posible:</strong> {alert.targetBundles.map(bundleLabel).join(" / ")}</p><p>{alert.rationale}</p><small><strong>Corpus:</strong> {alert.observedPatternCount} patrones, {alert.observedObservationCount} observaciones, {alert.observedCaseKeys.length} casos. <strong>Señales:</strong> {alert.matchedSignals.join(" · ") || "—"}</small><small><strong>Evidencia:</strong> {alert.evidenceToRequest.join(" · ")}</small><small className="functional-alert-caution">{alert.caution}</small>{alert.matchedObservedPatterns.length > 0 && <small className="functional-alert-observed"><strong>Ejemplos observados:</strong> {alert.matchedObservedPatterns.join(" · ")}</small>}</article>)}</div>{alerts.length > visibleAlerts.length && <p className="developer-detail-foot">Se muestran {visibleAlerts.length} alertas en pantalla; la exportación JSON/MD conserva las {alerts.length} alertas generadas.</p>}</section>;
}

function AccountStructurePanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const signals = analysis.accountSignals ?? [];
  if (!signals.length) return null;
  return <section className="account-structure-panel"><div className="precedent-projection-head"><div><span className="card-kicker">ESTRUCTURA DE LA CUENTA</span><h3>Paquetes, valores cero y trazabilidad</h3><p>Señales contables para solicitar composición, uso y fundamento del cobro separado.</p></div><div className="developer-analysis-badges"><span>{signals.length} señales</span><span>{signals.filter((signal) => signal.severity === "high").length} prioritarias</span></div></div><div className="functional-equivalence-summary"><strong>Cómo leerlas</strong><p>Un valor cero puede indicar inclusión en un paquete; una señal de itemización selectiva no prueba intención ni devolución.</p></div><div className="account-structure-list">{signals.slice(0, 18).map((signal) => <article key={signal.id}><div><span className={`functional-alert-level ${signal.severity === "high" ? "high" : signal.severity === "review" ? "medium" : "context"}`}>{signal.severity === "high" ? "Prioritaria" : signal.severity === "review" ? "Revisar" : "Informativa"}</span><b>{signal.title}</b></div><p>{signal.summary}</p><small><strong>Evidencia:</strong> {signal.evidenceToRequest.join(" · ")}</small></article>)}</div>{signals.length > 18 && <p className="developer-detail-foot">Se muestran 18 señales; la exportación conserva todas.</p>}</section>;
}

function DeveloperAnalysisDetail({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const rows = analysis.lineAssessments.filter((item) => !/bonificacion|copago|liquidacion|pam|ajuste/i.test(`${item.line.description} ${item.line.section || ""}`));
  const candidates = rows.filter((item) => Boolean(bestCombinedCandidate(analysis, item)));
  return <section className="developer-analysis-detail"><div className="developer-analysis-detail-head"><div><span className="card-kicker">ANÁLISIS DEL PRESTADOR</span><h3>Hipótesis técnicas trazables</h3><p>Estos resultados combinan reglas auditables y una segunda lectura semántica. Requieren contraste contractual y documental.</p></div><div className="developer-analysis-badges"><span>{rows.length} líneas en foco</span><span>{analysis.functionalEquivalenceAlerts?.length ?? 0} alertas funcionales</span></div></div><div className="developer-detail-metrics"><article><b>{rows.length}</b><small>Líneas en foco</small></article><article><b>{candidates.length}</b><small>Con hipótesis combinada</small></article><article><b>{money(candidates.reduce((sum, item) => sum + item.line.amount, 0))}</b><small>Valor presuntivo en revisión</small></article><article><b>{analysis.anomalies.length}</b><small>Señales</small></article></div><LlmSecondReaderPanel analysis={analysis}/><DeveloperBreakdownPanel analysis={analysis}/><AccountStructurePanel analysis={analysis}/><OperatingRoomScopePanel analysis={analysis}/><PrecedentProjectionPanel analysis={analysis} rows={rows}/><FunctionalEquivalencePanel analysis={analysis}/><ReasoningControlPanel analysis={analysis}/><div className="developer-line-table"><div className="developer-line-head"><span>Línea / origen</span><span>Hipótesis</span><span>Valor</span></div>{rows.map((item) => { const candidate = bestCombinedCandidate(analysis, item); const precedent = item.precedentComparisons?.[0]; const assisted = candidate?.knowledgeIds.includes("LLM-SECOND-READER-001"); return <article key={item.line.id}><div><b>{item.line.description}</b><small>{item.line.section || "Sin sección"} · pág. {item.line.page}{item.line.code ? ` · código ${item.line.code}` : ""}{item.line.confidence ? ` · lectura ${item.line.confidence}%` : ""}{item.line.assistedBy ? " · corrección visual trazada" : ""}</small>{item.line.sourceText && <small><strong>Texto original:</strong> {item.line.sourceText}</small>}</div><div><strong>{candidate ? `${Math.round(candidate.probability * 100)}%` : "Sin hipótesis"}</strong><small>{candidate ? `${assisted ? "Segunda lectura LLM" : "Motor de reglas"}: ${candidate.reasons[0] || "Hipótesis en revisión"}` : "Requiere clasificación adicional"}{precedent ? ` · Antecedente ${Math.round(precedent.comparability * 100)}% comparable` : ""}{candidate?.missingEvidence?.length ? ` · Falta: ${candidate.missingEvidence.join("; ")}` : ""}</small></div><b>{money(item.line.amount)}</b></article>; })}</div></section>;
}
function FlowStep({ number, title, state, detail }: { number: string; title: string; state: "complete" | "current" | "pending"; detail: string }) { return <div className={state}><span>{number}</span><b>{title}</b><small>{detail}</small></div>; }

function readerStatusLabel(status: NonNullable<DocumentExtraction["readerAssessment"]>["status"]) {
  return status === "reader_change_needed" ? "Cambio de lector sugerido" : status === "review_required" ? "Revisión técnica" : "Lectura estructurada";
}

function ReaderQualityPanel({ document: sourceDocument }: { document: CaseDocument }) {
  const assessment = sourceDocument.extraction?.readerAssessment;
  if (!assessment) return null;
  const proposal = buildReaderChangeProposal(assessment, sourceDocument.name);
  const technicalAlert = assessment.status === "reader_change_needed";
  const numericIssues = assessment.numericIssues ?? [];
  const issueCount = assessment.unknownItems.length + numericIssues.length;
  return <section className={`reader-quality-panel ${assessment.status}`}><div className="reader-quality-head"><div><span className="card-kicker">CONTROL DE LECTURA</span><h3>{technicalAlert ? "Este formato requiere revisión del lector" : "Calidad de lectura del documento"}</h3><p>{technicalAlert ? "La cuenta fue recibida, pero el motor no debe tratarla como completamente leída hasta revisar el formato o los renglones no reconocidos." : "La extracción está disponible para revisión; las alertas de lectura no son conclusiones sobre coberturas ni devoluciones."}</p></div><span className={`reader-quality-status ${assessment.status}`}>{readerStatusLabel(assessment.status)}</span></div><div className="reader-quality-metrics"><article><b>{Math.round(assessment.confidence * 100)}%</b><small>Confianza de lectura</small></article><article><b>{assessment.parserMode === "direct_pdf" ? "PDF" : assessment.parserMode === "mixed" ? "Mixto" : "OCR"}</b><small>Ruta utilizada</small></article><article><b>{issueCount}</b><small>Alertas de lectura</small></article><article><b>{assessment.lowConfidencePages.length || "—"}</b><small>Páginas a revisar</small></article></div><div className="reader-quality-signals"><b>Señales del lector</b>{assessment.signals.map((signal) => <span key={signal}>{signal}</span>)}</div>{assessment.unknownItems.length > 0 && <div className="reader-quality-unknown"><b>Elementos que no deben ocultarse</b>{assessment.unknownItems.slice(0, 8).map((item, index) => <div key={`${item.page}-${index}`}><span>Pág. {item.page}</span><strong>{item.value}</strong><small>{item.reason}</small></div>)}</div>}{numericIssues.length > 0 && <div className="reader-quality-unknown"><b>Inconsistencias numéricas detectadas</b>{numericIssues.slice(0, 8).map((item, index) => <div key={`numeric-${item.page}-${index}`}><span>Pág. {item.page}</span><strong>{item.value}</strong><small>{item.reason}</small></div>)}</div>}<div className="reader-quality-actions"><button className="portal-button portal-button-secondary" onClick={() => downloadJson(`${sourceDocument.id}-propuesta-lector.json`, proposal)}>Descargar propuesta JSON</button><button className="portal-button portal-button-primary" onClick={() => downloadReaderProposal(`${sourceDocument.id}-propuesta-lector.md`, sourceDocument)}>Descargar propuesta MD</button><button className="portal-button portal-button-secondary" onClick={() => downloadReaderReviewPackage(`${sourceDocument.id}-paquete-revision-llm.md`, sourceDocument)}>Preparar revisión humana / LLM</button><small>El paquete de revisión se descarga localmente y no envía la cuenta a terceros. La asistencia externa sólo propone correcciones; no cambia código ni despliega automáticamente.</small></div><p className="reader-quality-next"><b>Siguiente acción:</b> {assessment.nextAction}</p></section>;
}

function ReaderAssistPanel({ document: sourceDocument, busy, response, onAssist }: { document: CaseDocument; busy: boolean; response?: ReaderAssistResponse; onAssist: () => void }) {
  const result = response?.result;
  const assessment = sourceDocument.extraction?.readerAssessment;
  return <section className="reader-assist-panel"><div className="reader-assist-head"><div><span className="card-kicker">ASISTENCIA LLM AUXILIAR</span><h3>Apoyo para formatos o renglones dudosos</h3><p>El lector secundario puede proponer correcciones usando sólo la evidencia estructurada ya extraída. No decide coberturas ni aplica cambios automáticamente.</p></div><span className="reader-assist-badge">Sólo desarrollo</span></div><div className="reader-assist-summary"><span>i</span><p>{assessment?.codeChangeNeeded ? "El lector determinista pidió revisar este formato. La asistencia puede ordenar propuestas para un humano, pero no reemplaza el documento original." : "La cuenta tiene señales que conviene contrastar. La respuesta quedará como propuesta separada de la matriz."}</p></div><div className="reader-assist-actions"><button className="portal-button portal-button-primary" onClick={onAssist} disabled={busy || !sourceDocument.extraction}>{busy ? "Consultando asistencia…" : "Solicitar asistencia LLM"} →</button><small>Se envían líneas, campos no sensibles y texto de evidencia limitado; el PDF original no se envía en esta etapa.</small></div>{result && <div className={`reader-assist-result ${result.status}`}><div className="reader-assist-result-head"><b>{result.status === "assisted" ? "Propuesta recibida para revisión humana" : "Evidencia insuficiente"}</b><span>{response?.model}</span></div><p>{result.summary}</p>{result.lineCorrections.length > 0 && <div className="reader-assist-list"><strong>Correcciones de lectura sugeridas</strong>{result.lineCorrections.slice(0, 12).map((correction) => <article key={`${correction.index}-${correction.page}`}><b>Línea {correction.index} · pág. {correction.page}</b><span>{correction.description}{correction.amount !== null ? ` · ${money(correction.amount)}` : ""} · {Math.round(correction.confidence * 100)}%</span><small>{correction.reason}</small><em>Evidencia: {correction.evidence || "No informada"}</em></article>)}</div>}{result.unknownItems.length > 0 && <div className="reader-assist-list"><strong>Elementos que siguen dudosos</strong>{result.unknownItems.slice(0, 8).map((item, index) => <article key={`${item.page}-${index}`}><b>Pág. {item.page}</b><span>{item.value} · {Math.round(item.confidence * 100)}%</span><small>{item.reason}</small><em>Evidencia: {item.evidence || "No informada"}</em></article>)}</div>}{result.safetyNotes.length > 0 && <div className="reader-assist-notes">{result.safetyNotes.map((note) => <small key={note}>• {note}</small>)}</div>}{response?.warnings.map((warning) => <small className="reader-assist-warning" key={warning}>{warning}</small>)}</div>}</section>;
}

function VisionAssistPanel({ document: sourceDocument, busy, response, onAssist }: { document: CaseDocument; busy: boolean; response?: VisionAssistResponse; onAssist: () => void }) {
  const extraction = sourceDocument.extraction;
  const assessment = extraction?.readerAssessment;
  if (sourceDocument.sourceDeletedAt) return null;
  const candidatePages = [...new Set([
    ...(assessment?.lowConfidencePages || []),
    ...(extraction.ocrEnhancements?.map((item) => item.page) || []),
    ...(extraction.ocrPages || []),
  ])];
  const pageCount = Math.max(1, extraction?.pageCount || 4);
  const pageNumbers = (candidatePages.length ? candidatePages : Array.from({ length: Math.min(pageCount, 4) }, (_, index) => index + 1)).slice(0, 4);
  const gridSize = response?.gridSize ?? (extraction ? visionGridForExtraction(extraction) : 3);
  const imageCount = response?.reviewedImageCount ?? pageNumbers.length * gridSize * gridSize;
  const result = response?.result;
  return (
    <section className="reader-assist-panel reader-vision-panel">
      <div className="reader-assist-head">
        <div>
          <span className="card-kicker">GPT VISION · SEGUNDO LECTOR</span>
          <h3>Revisión automática por zonas</h3>
          <p>Cuando el OCR presenta señales de baja calidad, el sistema selecciona las páginas más dudosas y las divide en zonas para que GPT Vision pueda proponer correcciones visibles. La revisión se limita a la cuenta clínica y no decide coberturas, desfragmentaciones ni conclusiones legales.</p>
        </div>
        <span className="reader-assist-badge">{busy ? "En curso" : "Automático · sólo desarrollo"}</span>
      </div>
      <div className="reader-assist-summary">
        <span>◈</span>
        <p>{busy ? `Se están preparando hasta ${pageNumbers.length} página(s) en una malla ${gridSize}×${gridSize} (${imageCount} zonas posibles).` : result ? `La revisión visual terminó sobre ${response?.reviewedPages.length || pageNumbers.length} página(s), con ${response?.reviewedImageCount || imageCount} zona(s) enviada(s).` : `La cuenta tiene señales para revisión visual. Se usarán hasta ${pageNumbers.length} página(s) y una malla ${gridSize}×${gridSize}; el botón permite reintentarla cuando sea necesario.`}</p>
      </div>
      <div className="reader-assist-actions">
        <button className="portal-button portal-button-primary" onClick={onAssist} disabled={busy || !pageNumbers.length}>{busy ? "Procesando zonas…" : result ? "Reintentar GPT Vision" : "Revisar zonas con GPT Vision"} →</button>
        <small>La revisión automática se activa al cargar o reemplazar una cuenta con OCR bajo. Sólo se envían las zonas seleccionadas a OpenAI; la propuesta queda separada de la matriz y siempre requiere revisión humana.</small>
      </div>
      {result && <div className={`reader-assist-result ${result.status}`}>
        <div className="reader-assist-result-head"><b>{result.status === "assisted" ? "Propuesta visual recibida para revisión humana" : "Evidencia visual insuficiente"}</b><span>{response?.model} · págs. {response?.reviewedPages.join(", ") || "—"} · malla {response?.gridSize || gridSize}×{response?.gridSize || gridSize}</span></div>
        <p>{result.summary}</p>
        {result.fields.length > 0 && <div className="reader-assist-list"><strong>Campos visibles sugeridos</strong>{result.fields.slice(0, 8).map((field) => <article key={`${field.key}-${field.page}`}><b>{field.label} · pág. {field.page}</b><span>{field.value} · {Math.round(field.confidence * 100)}%</span><small>{field.evidence || "Sin evidencia textual informada"}</small></article>)}</div>}
        {result.lineCorrections.length > 0 && <div className="reader-assist-list"><strong>Correcciones de lectura sugeridas</strong>{result.lineCorrections.slice(0, 12).map((correction) => <article key={`${correction.index}-${correction.page}`}><b>Línea {correction.index} · pág. {correction.page}</b><span>{correction.description}{correction.amount !== null ? ` · ${money(correction.amount)}` : ""} · {Math.round(correction.confidence * 100)}%</span><small>{correction.reason}</small><em>Evidencia: {correction.evidence || "No informada"}</em></article>)}</div>}
        {result.unknownItems.length > 0 && <div className="reader-assist-list"><strong>Elementos que siguen dudosos</strong>{result.unknownItems.slice(0, 8).map((item, index) => <article key={`${item.page}-${index}`}><b>Pág. {item.page}</b><span>{item.value} · {Math.round(item.confidence * 100)}%</span><small>{item.reason}</small><em>Evidencia: {item.evidence || "No informada"}</em></article>)}</div>}
        {result.safetyNotes.map((note) => <small className="reader-assist-warning" key={note}>{note}</small>)}
        {response?.warnings.map((warning) => <small className="reader-assist-warning" key={warning}>{warning}</small>)}
      </div>}
    </section>
  );
}

function ReaderFailurePanel({ document: sourceDocument, busy, onRetry }: { document: CaseDocument; busy: boolean; onRetry: () => void }) {
  if (sourceDocument.processingStatus !== "failed") return null;
  return <section className="reader-quality-panel reader_change_needed"><div className="reader-quality-head"><div><span className="card-kicker">LECTURA DETENIDA</span><h3>La cuenta no quedó sin registrar</h3><p>El archivo original sigue vinculado temporalmente al expediente. La extracción falló antes de producir una matriz confiable, por lo que no se mostrarán montos ni hipótesis inventadas.</p></div><span className="reader-quality-status reader_change_needed">Requiere atención</span></div><div className="reader-failure-message"><b>Detalle técnico informado</b><span>{sourceDocument.processingError || "El lector no pudo procesar este formato."}</span></div><div className="reader-quality-actions"><button className="portal-button portal-button-primary" onClick={onRetry} disabled={busy || Boolean(sourceDocument.sourceDeletedAt)}>{busy ? "Reintentando lectura…" : "Reintentar lectura del original"}</button><a className="portal-button portal-button-secondary" href={`/api/documents?caseId=${encodeURIComponent(sourceDocument.caseId)}&documentId=${encodeURIComponent(sourceDocument.id)}&download=source`}>Descargar original temporal</a><small>El reintento usa el mismo original temporal y no duplica la cuenta. Si vuelve a fallar, conserva el archivo para revisión humana o LLM externa.</small></div></section>;
}

function DeveloperDocuments({ snapshot, busy, pendingUpload, uploadProgress, uploadStage, onFile, onAnalyze, onRetryReader, readerAssistBusy, readerAssistResponse, onReaderAssist, visionAssistBusy, visionAssistResponse, onVisionAssist }: { snapshot: Snapshot; busy: boolean; pendingUpload?: PendingUpload; uploadProgress: number; uploadStage: string; onFile: (file: File, classification: string) => void; onAnalyze: () => void; onRetryReader: () => void; readerAssistBusy: boolean; readerAssistResponse?: ReaderAssistResponse; onReaderAssist: () => void; visionAssistBusy: boolean; visionAssistResponse?: VisionAssistResponse; onVisionAssist: () => void }) { const account = accountDoc(snapshot); const assessment = account?.extraction?.readerAssessment; const needsReaderAssist = Boolean(account && (account.processingStatus === "failed" || !assessment || assessment.status !== "ready" || visionAssistBusy || visionAssistResponse)); return <div className="developer-documents"><DeveloperCaseIdentity snapshot={snapshot}/><div className="traceability-toolbar"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h3>Fuentes cargadas</h3></div><span className="document-replacement-note">Los archivos nuevos quedan vinculados al caso</span></div>{account?.processingStatus === "failed" && <ReaderFailurePanel document={account} busy={busy} onRetry={onRetryReader}/>} {account && <ReaderQualityPanel document={account}/>} {needsReaderAssist && account && <ReaderAssistPanel document={account} busy={readerAssistBusy} response={readerAssistResponse} onAssist={onReaderAssist}/>} {needsReaderAssist && account && <VisionAssistPanel document={account} busy={visionAssistBusy} response={visionAssistResponse} onAssist={onVisionAssist}/>}<div className="dev-document-grid"><OperationalDoc type="Cuenta clínica" document={account} classification="Cuenta clínica" busy={busy} pendingFile={pendingUpload?.classification === "Cuenta clínica" ? pendingUpload : undefined} uploadProgress={uploadProgress} uploadStage={uploadStage} onFile={onFile} analysisAvailable={Boolean(snapshot.analysis)} onAnalyze={onAnalyze}/><OperationalDoc type="PAM / liquidación" document={pamDoc(snapshot)} classification="PAM / liquidación" busy={busy} pendingFile={pendingUpload?.classification === "PAM / liquidación" ? pendingUpload : undefined} uploadProgress={uploadProgress} uploadStage={uploadStage} onFile={onFile}/><OperationalDoc type="Contrato / plan" document={snapshot.documents.find((doc) => /contrato|plan/i.test(doc.classification))} classification="Contrato" busy={busy} pendingFile={pendingUpload?.classification === "Contrato" ? pendingUpload : undefined} uploadProgress={uploadProgress} uploadStage={uploadStage} onFile={onFile}/></div></div>; }
function OperationalDoc({ type, document, classification, busy, pendingFile, uploadProgress, uploadStage, onFile, onAnalyze, analysisAvailable }: { type: string; document?: CaseDocument; classification: string; busy: boolean; pendingFile?: PendingUpload; uploadProgress: number; uploadStage: string; onFile: (file: File, classification: string) => void; onAnalyze?: () => void; analysisAvailable?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const cannotAnalyze = analysisBlocked(document);
  const processingFile = Boolean(pendingFile && busy);
  const displayName = pendingFile?.name || document?.name || "Esperando archivo";
  const displayStatus = processingFile
    ? `${uploadStage || "Procesando documento"} · ${uploadProgress}%`
    : document
      ? `${document.extraction?.pageCount || "-"} páginas · ${processingLabel(document)}`
      : "Pendiente";
  return <article className={`dev-doc ${document || processingFile ? "" : "pending"}`}><span className="file-mark">{document || processingFile ? "PDF" : "+"}</span><div><span>{type}</span><b>{displayName}</b><small>{displayStatus}</small></div><div className="dev-doc-actions"><button onClick={() => input.current?.click()} disabled={busy}>{document ? "Reemplazar" : "Cargar"}</button>{document && ["failed", "review_required"].includes(document.processingStatus || "") && !document.sourceDeletedAt && <a href={`/api/documents?caseId=${encodeURIComponent(document.caseId)}&documentId=${encodeURIComponent(document.id)}&download=source`}>Descargar original temporal</a>}{onAnalyze && <button className="dev-doc-analyze" onClick={onAnalyze} disabled={busy || cannotAnalyze} title={cannotAnalyze ? "La cuenta necesita una lectura completa o un cambio de lector antes del análisis." : "La revisión técnica no impide generar un análisis preliminar."}>{busy ? "Procesando…" : analysisAvailable ? "Actualizar análisis" : "Analizar cuenta"} →</button>}</div><input ref={input} hidden type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file, classification); }} /></article>;
}
