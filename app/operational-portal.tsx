"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { extractHealthcareDocument } from "../lib/extraction/client";
import type { DocumentExtraction } from "../lib/extraction/types";
import type { ClinicalAccountAnalysis, ChileanBillingLine } from "../lib/rules/chilean-account";
import type { FunctionalEquivalenceAlert } from "../lib/rules/observed-corpus";
import { generateClarificationClaimMarkdown } from "../lib/claims/claim-generator";
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
  createdAt: string;
  extraction?: DocumentExtraction;
};
type Activity = { id: string; title: string; detail: string; date: string; pending?: boolean };
type Authorization = { authorized: boolean; scope: string; at?: string };
type Snapshot = {
  case: { id: string; patientName: string; episodeLabel: string; status: string; createdAt: string; updatedAt: string };
  documents: CaseDocument[];
  analysis?: ClinicalAccountAnalysis;
  authorization?: Authorization;
  activities: Activity[];
  corpusStatus?: "pending_review" | "validated" | "rejected";
};
type CaseRow = { id: string; patient_name: string; episode_label: string; status: string; document_count: number };

const money = (value: number) => `$${Math.round(value || 0).toLocaleString("es-CL")}`;

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
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

function totalFrom(doc: CaseDocument | undefined, kind: "account" | "pam") {
  const group = doc?.extraction?.[kind];
  const fieldKey = kind === "account" ? "total" : "billed_total";
  const field = group?.fields.find((item) => item.key === fieldKey);
  const fieldValue = field ? Number(field.value.replace(/[^0-9-]/g, "")) : 0;
  return fieldValue || group?.lines.reduce((sum, line) => sum + line.amount, 0) || 0;
}

function possibleDisputeAmount(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.lineAssessments ?? [])
    .filter((assessment) => assessment.candidates.some((candidate) => candidate.probability >= DEVELOPER_CANDIDATE_THRESHOLD))
    .reduce((sum, assessment) => sum + assessment.line.amount, 0);
}

const DEVELOPER_CANDIDATE_THRESHOLD = 0.45;
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
    const candidate = bestDeveloperCandidate(assessment, "operating_room");
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

  const alternatives = analysis.lineAssessments.flatMap((assessment) => assessment.candidates
    .filter((candidate) => candidate.bundle !== "operating_room" && candidate.probability >= DEVELOPER_CANDIDATE_THRESHOLD)
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 1)
    .map((candidate) => ({
      line: assessment.line,
      candidate,
      overlapsPavilion: pavilionLineIds.has(assessment.line.id),
    })));

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

async function uploadDocument(caseId: string, file: File, classification: string, onProgress?: (value: number) => void) {
  const documentId = crypto.randomUUID();
  const body = new FormData();
  body.append("caseId", caseId);
  body.append("documentId", documentId);
  body.append("classification", classification);
  body.append("confidence", "95");
  body.append("file", file);
  const upload = await fetch("/api/documents", { method: "POST", body });
  if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).error || "No se pudo guardar el documento");
  const extraction = await extractHealthcareDocument(file, expectedKind(classification), onProgress);
  const saved = await fetch("/api/extractions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId, extraction }),
  });
  if (!saved.ok) throw new Error("El documento se guardó, pero la extracción no pudo persistirse");
  const sourceKind = /pam|liquid/i.test(classification)
    ? "pam"
    : /cuenta|mixto/i.test(classification)
      ? "account"
      : undefined;
  let corpusRegistered = false;
  const sourceLines = sourceKind
    ? (extraction[sourceKind]?.lines ?? []).map((line, index) => ({
        ...line,
        id: `${documentId}-${index}`,
        documentId,
      }))
    : [];
  if (sourceKind && sourceLines.length) {
    const corpusResponse = await fetch("/api/corpus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        caseId,
        sourceKind,
        sourceDocumentId: documentId,
        episodeClass: classification,
        lines: sourceLines,
      }),
    });
    corpusRegistered = corpusResponse.ok;
  }
  return { documentId, extraction, corpusRegistered };
}

async function analyzeCase(caseId: string, document?: CaseDocument, episodeLabel?: string) {
  const lines: ChileanBillingLine[] = document?.extraction?.account?.lines.map((line, index) => ({
    ...line,
    id: `${document.id}-${index}`,
    documentId: document.id,
  })) ?? [];
  if (!lines.length) throw new Error("La cuenta no tiene líneas extraídas para analizar");
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, episodeLabel, lines }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "No se pudo analizar la cuenta");
  return response.json() as Promise<ClinicalAccountAnalysis>;
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
  const candidateCount = analysis.lineAssessments.reduce((sum, item) => sum + item.candidates.length, 0);
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
    const hypotheses = assessment.candidates.length
      ? assessment.candidates.map((candidate) => {
          const evidence = candidate.missingEvidence.length
            ? `Falta: ${candidate.missingEvidence.join("; ")}`
            : "Sin evidencia faltante declarada";
          return `${bundleLabel(candidate.bundle)} (${Math.round(candidate.probability * 100)}%). ${evidence}. IDs: ${candidate.knowledgeIds.join(", ") || "—"}`;
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
        <div className="portal-brand"><span>R</span> RevisaTuCuenta</div>
        <p className="portal-kicker">Portal operativo de casos clínicos</p>
        <h1>Una cuenta clara empieza por un expediente ordenado.</h1>
        <p className="portal-entry-copy">Paciente y equipo de revisión trabajan sobre el mismo caso persistido, con documentos separados y trazabilidad por página.</p>
        <div className="portal-entry-actions">
          <a className="portal-button portal-button-primary" href="/?view=patient">Revisar mi cuenta</a>
          <a className="portal-button portal-button-secondary" href="/?view=developer">Abrir consola de desarrollo ↗</a>
        </div>
        <div className="portal-entry-foot"><span>●</span> Estado sincronizado con el expediente</div>
      </div>
    </main>
  );
}

function PatientStart({ onCreated }: { onCreated: (caseId: string) => void }) {
  const [name, setName] = useState("");
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
      const created = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, patientName: name || "Paciente", episodeLabel: episode }) });
      if (!created.ok) throw new Error("No se pudo crear el expediente");
      if (file) await uploadDocument(id, file, "Cuenta clínica");
      onCreated(id);
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo crear el expediente"));
    } finally {
      setBusy(false);
    }
  }

  return <main className="patient-login"><form className="patient-login-card" onSubmit={submit}><div className="portal-brand"><span>R</span> RevisaTuCuenta</div><div className="login-seal">⌁</div><p className="portal-kicker">Nuevo expediente</p><h1>Comienza tu revisión.</h1><p>Ingresa tus datos y, si ya la tienes, carga la cuenta clínica del prestador.</p><input aria-label="Nombre" placeholder="Nombre para identificar el caso" value={name} onChange={(event) => setName(event.target.value)} /><input aria-label="Episodio" placeholder="Episodio o atención" value={episode} onChange={(event) => setEpisode(event.target.value)} /><label className="portal-button portal-button-secondary"><input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(event) => setFile(event.target.files?.[0])} />{file ? file.name : "Cargar cuenta clínica"}</label>{error && <p className="patient-analysis-notice">{error}</p>}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "Creando expediente…" : "Crear expediente"}</button><a className="back-link" href="/">← Volver</a></form></main>;
}

export function PatientPortal({ initialCaseId = "" }: { initialCaseId?: string }) {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<"Resumen" | "Documentos" | "Actividad">("Resumen");
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Esperando documentos");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const accountInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!caseId) return;
    try { setError(""); const next = await getSnapshot(caseId); setSnapshot(next); if (next.analysis) setStatus("complete"); }
    catch (reason) { setError(errorMessage(reason, "No se pudo cargar el expediente")); }
  }
  useEffect(() => { void refresh(); }, [caseId]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3000); }

  async function handlePam(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !caseId) return;
    setBusy(true); setProgress(0); setStage("Guardando PAM / liquidación");
    try { await uploadDocument(caseId, file, "PAM / liquidación", (value) => setProgress(value)); await refresh(); notify("PAM cargado y vinculado al expediente"); }
    catch (reason) { notify(errorMessage(reason, "No se pudo cargar el PAM")); }
    finally { setBusy(false); }
  }

  async function handleAccount(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !caseId) return;
    setBusy(true); setProgress(0); setStage("Guardando cuenta clínica");
    try { await uploadDocument(caseId, file, "Cuenta clinica", (value) => setProgress(value)); await refresh(); notify("Cuenta clínica cargada y vinculada al expediente"); }
    catch (reason) { notify(errorMessage(reason, "No se pudo cargar la cuenta clínica")); }
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
    try { await analyzeCase(caseId, accountDoc(snapshot), snapshot.case.episodeLabel); setProgress(100); setStage("Resultado disponible para revisión"); setStatus("complete"); await refresh(); notify("Análisis guardado en el expediente"); }
    catch (reason) { setStatus("error"); setError(errorMessage(reason, "No se pudo analizar la cuenta")); }
    finally { window.clearInterval(timer); setBusy(false); }
  }

  async function authorize() {
    setBusy(true);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/authorization`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!response.ok) { notify("No se pudo registrar la solicitud"); return; }
      await refresh(); notify("Solicitud de asesoría registrada");
    } finally { setBusy(false); }
  }

  async function removeDocument(document: CaseDocument) {
    if (!caseId || !window.confirm(`¿Quieres borrar "${document.name}" del expediente? Esta acción también quitará su análisis asociado.`)) return;
    setBusy(true); setDeletingDocumentId(document.id);
    try {
      const response = await fetch(`/api/documents?caseId=${encodeURIComponent(caseId)}&documentId=${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo borrar el documento");
      await refresh();
      notify("Documento borrado del expediente");
    } catch (reason) {
      notify(errorMessage(reason, "No se pudo borrar el documento"));
    } finally { setBusy(false); setDeletingDocumentId(""); }
  }

  if (!caseId) return <PatientStart onCreated={setCaseId} />;
  if (error && !snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>No se pudo abrir el expediente</h2><p>{error}</p><button className="portal-button portal-button-primary" onClick={() => void refresh()}>Reintentar</button></section></main>;
  if (!snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>Cargando expediente…</h2></section></main>;

  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const accountTotal = totalFrom(account, "account"); const pamTotal = totalFrom(pam, "pam");
  const firstName = snapshot.case.patientName.split(" ")[0];
  return <main className="patient-portal">
    <header className="patient-topbar"><a className="portal-brand" href="/"><span>R</span> RevisaTuCuenta</a><div className="patient-topbar-right"><span className="surface-pill patient-pill">Vista paciente</span><span className="avatar">{snapshot.case.patientName.slice(0, 2).toUpperCase()}</span><span className="patient-email">{snapshot.case.patientName}</span><a className="patient-signout-button" href="/signout-with-chatgpt?return_to=%2F" aria-label="Cerrar sesión">Cerrar sesión</a></div></header>
    <div className="patient-layout"><aside className="patient-sidebar"><div className="case-mini"><span className="case-icon">⌁</span><div><small>CASO ACTIVO</small><b>{snapshot.case.patientName}</b><span>Expediente {caseId.slice(0, 8)}</span></div></div><nav className="patient-nav">{(["Resumen", "Documentos", "Actividad"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav><div className="patient-sidebar-help"><span>?</span><div><b>¿Necesitas ayuda?</b><small>Escríbenos sobre tu caso.</small></div></div></aside>
      <section className="patient-main"><div className="patient-heading"><div><p className="portal-kicker">Mi expediente</p><h1>Hola, {firstName}.</h1><p>{snapshot.case.episodeLabel}</p></div><span className="case-status"><i /> En análisis</span></div>
        {tab === "Resumen" && <PatientSummary account={account} pam={pam} reviewAmount={possibleDisputeAmount(snapshot.analysis)} analysisAvailable={Boolean(snapshot.analysis)} analysisRunning={status === "running"} progress={progress} stage={stage} authorized={Boolean(snapshot.authorization?.authorized)} busy={busy} onAccount={() => accountInputRef.current?.click()} onPam={() => inputRef.current?.click()} onAnalyze={() => void runAnalysis()} onAuthorize={() => void authorize()} />}
        {tab === "Documentos" && <PatientDocuments snapshot={snapshot} deletingDocumentId={deletingDocumentId} onAccount={() => accountInputRef.current?.click()} onPam={() => inputRef.current?.click()} onDelete={(document) => void removeDocument(document)} />}
        {tab === "Actividad" && <PatientActivity activities={snapshot.activities} />}
      </section></div>
    <input ref={accountInputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={handleAccount} /><input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={handlePam} />{toast && <div className="portal-toast"><span>✓</span>{toast}</div>}
  </main>;
}

function PatientSummary({ account, pam, reviewAmount, analysisAvailable, analysisRunning, progress, stage, authorized, busy, onAccount, onPam, onAnalyze, onAuthorize }: { account?: CaseDocument; pam?: CaseDocument; reviewAmount: number; analysisAvailable: boolean; analysisRunning: boolean; progress: number; stage: string; authorized: boolean; busy: boolean; onAccount: () => void; onPam: () => void; onAnalyze: () => void; onAuthorize: () => void }) {
  const documentsReceived = Boolean(account || pam);
  return <><section className="patient-card patient-review-status-card"><span className="card-kicker">ESTADO DEL EXPEDIENTE</span><h2>{documentsReceived ? "Tu cuenta está en análisis" : "Completa tu expediente"}</h2><p>{documentsReceived ? "Hemos recibido tus documentos. El expediente se encuentra en revisión y te informaremos cuando exista una actualización." : "Carga la cuenta clínica para iniciar la revisión del expediente."}</p><div className="patient-review-status"><span><i /> {documentsReceived ? "Revisión en curso" : "Esperando documentos"}</span><small>La información técnica se mantiene bajo revisión interna.</small></div><div className="patient-review-flow" aria-label="Estado general del expediente"><div className={documentsReceived ? "complete" : ""}><i>1</i><span>Documentos recibidos</span></div><div className={documentsReceived ? "current" : ""}><i>2</i><span>{documentsReceived ? "Revisión en curso" : "Revisión pendiente"}</span></div><div><i>3</i><span>Actualización posterior</span></div></div>{account && !analysisAvailable && <section className="patient-analysis-launch"><div><span className="card-kicker">REVISIÓN PRELIMINAR</span><h3>{analysisRunning ? stage : "Analiza tu cuenta"}</h3><p>{analysisRunning ? "Estamos ordenando la información para estimar el monto sujeto a revisión." : "Ejecuta una revisión preliminar para conocer si existen cargos que conviene aclarar."}</p></div>{analysisRunning ? <div className="patient-analysis-progress-wrap"><div className="patient-analysis-progress-label"><span>{progress}%</span><b>Procesando</b></div><div className="patient-analysis-progress-bar"><i style={{ width: `${progress}%` }} /></div></div> : <button className="patient-analyze-button" onClick={onAnalyze} disabled={busy}>Analizar cuenta →</button>}</section>}{analysisAvailable && reviewAmount > 0 && <><div className="patient-review-amount"><div><span className="card-kicker">MONTO APROXIMADO BAJO REVISIÓN</span><strong>{money(reviewAmount)}</strong></div><p>Existen montos que requieren revisión por posibles devoluciones o errores de facturación. Algunos podrían ser recuperables, pero esto debe confirmarse al revisar el caso; no constituye una devolución garantizada.</p></div><section className="patient-advisory-card"><div><span className="card-kicker">ASESORÍA INICIAL GRATUITA</span><h3>Revisemos si existen montos recuperables</h3><p>La asesoría inicial es gratuita. Si la revisión identifica montos con posibilidad de recuperación, nuestro equipo se pondrá en contacto contigo para explicarte los antecedentes y los pasos siguientes. La eventual recuperación dependerá de la revisión y del reclamo correspondiente.</p></div>{authorized ? <div className="patient-advisory-confirmed"><b>Solicitud de asesoría registrada</b><small>Nuestro equipo se pondrá en contacto contigo.</small></div> : <button className="portal-button portal-button-primary" onClick={onAuthorize} disabled={busy}>{busy ? "Registrando…" : "Solicitar asesoría inicial gratis"} →</button>}</section></>}<div className="patient-review-actions"><button className="portal-button portal-button-secondary" onClick={onAccount} disabled={busy}>{account ? "Reemplazar cuenta" : "Agregar cuenta clínica"}</button><button className="portal-button portal-button-primary" onClick={onPam} disabled={busy}>{pam ? "Reemplazar PAM" : "Agregar PAM / liquidación"}</button></div></section><section className="patient-card next-card"><span className="card-kicker">SIGUIENTE PASO</span><h2>{documentsReceived ? "Revisión interna" : "Completa tus documentos"}</h2><p>{documentsReceived ? "No necesitas realizar otra acción mientras el expediente continúa en revisión." : "Carga los documentos disponibles para completar el expediente."}</p></section></>;
}

function PatientDocuments({ snapshot, deletingDocumentId, onAccount, onPam, onDelete }: { snapshot: Snapshot; deletingDocumentId: string; onAccount: () => void; onPam: () => void; onDelete: (document: CaseDocument) => void }) { return <section className="patient-card documents-view"><div className="card-heading"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h2>Fuentes cargadas</h2></div><div className="document-actions"><button className="portal-button portal-button-secondary" onClick={onAccount}>Agregar cuenta +</button><button className="portal-button portal-button-primary" onClick={onPam}>Agregar PAM +</button></div></div><div className="document-list">{snapshot.documents.map((doc) => <article className="patient-document clinic" key={doc.id}><span className="file-mark">PDF</span><div><span>{doc.classification}</span><b>{doc.name}</b><small>{doc.extraction?.pageCount || "-"} páginas · {doc.extraction ? "Extraído" : "Pendiente"}</small></div><div className="document-status"><em>Disponible</em><button className="patient-document-delete" onClick={() => onDelete(doc)} disabled={Boolean(deletingDocumentId)}>{deletingDocumentId === doc.id ? "Borrando…" : "Borrar documento"}</button></div></article>)}</div><div className="document-tip"><span>i</span><p>La cuenta muestra los cargos del prestador y el PAM la liquidación de cobertura. Cada documento mantiene su origen.</p></div></section>; }
function PatientActivity({ activities }: { activities: Activity[] }) {
  const latestDate = activities.length ? new Date(activities[activities.length - 1].date).toLocaleString("es-CL") : "Ahora";
  return <section className="patient-card activity-view"><span className="card-kicker">ACTIVIDAD</span><h2>Movimientos del expediente</h2><div className="activity-list"><div className="activity-item pending"><span className="activity-dot" /><div><small>{latestDate}</small><b>Revisión en curso</b><p>Tu expediente permanece en análisis. Te informaremos cuando exista una actualización.</p></div></div></div></section>;
}

function useCases() {
  const [cases, setCases] = useState<CaseRow[]>([]); const [error, setError] = useState("");
  const refresh = async () => { try { const response = await fetch("/api/cases", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setCases(payload.cases || []); } catch (reason) { setError(errorMessage(reason, "No se pudieron cargar los casos")); } };
  useEffect(() => { void refresh(); }, []); return { cases, error, refresh };
}

function DeveloperEmpty({ error, onCreated }: { error?: string; onCreated: (caseId: string) => Promise<void> }) {
  const [patientName, setPatientName] = useState("");
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
        body: JSON.stringify({ id, patientName: patientName || "Paciente", episodeLabel }),
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
        <div className="portal-brand dev-empty-brand"><span>R</span> RevisaTuCuenta</div>
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
  const { cases, error: casesError, refresh: refreshCases } = useCases();
  const [selectedId, setSelectedId] = useState(initialCaseId);
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [tab, setTab] = useState<"overview" | "traceability" | "documents">("documents"); const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const selected = cases.some((item) => item.id === selectedId) ? selectedId : cases[0]?.id || "";
  async function refresh() { if (!selected) return; try { setSnapshot(await getSnapshot(selected)); } catch (reason) { setNotice(errorMessage(reason, "No se pudo cargar el expediente")); } }
  useEffect(() => { void refresh(); }, [selected]);
  async function onFile(file: File, classification: string) { if (!selected) return; setBusy(true); try { const result = await uploadDocument(selected, file, classification); await refresh(); await refreshCases(); setNotice(result.corpusRegistered ? "Documento guardado, extraído y enviado a revisión de aprendizaje" : "Documento guardado y extraído; el aprendizaje quedó pendiente de sincronización"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo procesar el documento")); } finally { setBusy(false); } }
  async function onAnalyze() { if (!snapshot) return; setBusy(true); try { await analyzeCase(selected, accountDoc(snapshot), snapshot.case.episodeLabel); await refresh(); await refreshCases(); setTab("traceability"); setNotice("Análisis guardado; la observación quedó pendiente de revisión de corpus"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo analizar el caso")); } finally { setBusy(false); } }
  async function onCorpusStatus(status: "pending_review" | "validated" | "rejected") { if (!selected) return; setBusy(true); try { const response = await fetch(`/api/cases/${encodeURIComponent(selected)}/corpus`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el corpus"); await refresh(); setNotice(payload.message || "Estado del corpus actualizado"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo actualizar el corpus")); } finally { setBusy(false); } }
  const visibleCases = useMemo(() => cases.filter((item) => `${item.patient_name} ${item.id} ${item.episode_label}`.toLowerCase().includes(query.toLowerCase())), [cases, query]);
  if (!selected) return <DeveloperEmpty error={casesError} onCreated={async (id) => { setSelectedId(id); await refreshCases(); }} />;
  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const total = totalFrom(account, "account");
  return <main className="developer-portal"><aside className="developer-sidebar"><a className="portal-brand dev-brand" href="/"><span>R</span> RevisaTuCuenta</a><div className="dev-workspace-label">ESPACIO DE TRABAJO</div><nav className="dev-nav"><a className="active" href="/?view=developer"><span>▦</span> Expedientes <em>{cases.length}</em></a><a href="#rules"><span>◌</span> Reglas del motor</a><a href="#corpus"><span>⌁</span> Corpus observado</a></nav><div className="dev-sidebar-bottom"><a href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer"><span>↗</span> Vista paciente</a><div className="dev-user"><span className="avatar">DEV</span><div><b>Desarrollador</b><small>Expedientes operativos</small></div></div></div></aside><section className="developer-main"><header className="developer-header"><div><p className="portal-kicker">CONSOLA DE DESARROLLO</p><h1>Expedientes</h1><p>Revisión técnica sobre los documentos persistidos del caso seleccionado.</p></div><div className="developer-header-actions"><span className="surface-pill developer-pill">Vista desarrollador</span><a className="portal-button portal-button-secondary" href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer">Abrir vista paciente ↗</a></div></header><div className="developer-body"><section className="case-queue"><div className="queue-header"><div><span className="card-kicker">BANDEJA DE CASOS</span><h2>Casos recientes <em>{cases.length}</em></h2></div></div><div className="queue-search">⌕ <input placeholder="Buscar paciente, cuenta o episodio" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="queue-list">{visibleCases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`dev-case-row ${selected === item.id ? "active" : ""}`}><span className="avatar">{item.patient_name.slice(0, 2).toUpperCase()}</span><div><b>{item.patient_name}</b><small>{item.id} · {item.document_count} documentos</small></div><em className={item.status.includes("analysis") ? "green" : "blue"}>{item.status}</em></button>)}</div></section><section className="case-detail"><div className="case-detail-head"><div><span className="case-breadcrumb">EXPEDIENTE / {selected}</span><h2>{snapshot?.case.patientName || "Cargando…"}</h2><p>{snapshot?.case.episodeLabel || ""}</p></div><span className="case-state"><i /> {snapshot?.case.status || "Cargando"}</span></div>{snapshot && <><div className="dev-summary-metrics"><DevMetric label="Cuenta clínica" value={money(total)} detail="Documento base"/><DevMetric label="Desfragmentación" value={snapshot.analysis ? `${snapshot.analysis.lineAssessments.length} líneas` : "Pendiente"} detail="Hipótesis técnicas" pending={!snapshot.analysis}/><DevMetric label="Contexto PAM" value={pam ? "Recibido" : "Pendiente"} detail="Se conserva separado" pending={!pam}/><DevMetric label="Autorización" value={snapshot.authorization?.authorized ? "Otorgada" : "Pendiente"} detail="Gestión de reclamos" pending={!snapshot.authorization?.authorized}/><DevMetric label="Documentos" value={String(snapshot.documents.length)} detail="Fuentes del caso"/></div><div className="dev-tabs">{(["overview", "traceability", "documents"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "overview" ? "Resumen" : item === "traceability" ? "Matriz de trazabilidad" : "Documentos"}</button>)}</div>{notice && <p className="patient-analysis-notice">{notice}</p>}{tab === "overview" && <DeveloperOverview snapshot={snapshot} total={total} busy={busy} onAnalyze={() => void onAnalyze()} onExport={() => downloadJson(`${selected}-preinforme.json`, snapshot)} onClaimDraft={() => downloadClaim(`${selected}-solicitud-aclaracion.md`, snapshot)} onCorpusStatus={onCorpusStatus} />}{tab === "traceability" && <DeveloperTraceability snapshot={snapshot} onExport={() => downloadJson(`${selected}-matriz.json`, snapshot.analysis)} onExportMarkdown={() => snapshot.analysis && downloadMarkdown(`${selected}-matriz.md`, snapshot.analysis)} />}{tab === "documents" && <DeveloperDocuments snapshot={snapshot} busy={busy} onFile={(file, kind) => void onFile(file, kind)} />}</>}</section></div></section></main>;
}

function DevMetric({ label, value, detail, pending }: { label: string; value: string; detail: string; pending?: boolean }) { return <article className={`dev-metric ${pending ? "pending" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function DeveloperOverview({ snapshot, total, busy, onAnalyze, onExport, onClaimDraft, onCorpusStatus }: { snapshot: Snapshot; total: number; busy: boolean; onAnalyze: () => void; onExport: () => void; onClaimDraft: () => void; onCorpusStatus: (status: "pending_review" | "validated" | "rejected") => void }) { const account = accountDoc(snapshot); const analysis = snapshot.analysis; const candidates = analysis?.lineAssessments.filter((item) => item.candidates.some((candidate) => candidate.probability >= 0.45)) || []; return <div className="developer-overview"><div className="dev-flow-card"><div className="card-heading"><div><span className="card-kicker">FLUJO DEL EXPEDIENTE</span><h3>Cuenta clínica primero</h3></div><span className="dev-percentage">{analysis ? "100%" : "50%"}</span></div><div className="dev-flow"><FlowStep number="01" title="Cuenta" state={account ? "complete" : "pending"} detail={account ? "Recibida" : "Pendiente"}/><i/><FlowStep number="02" title="Análisis" state={analysis ? "complete" : "current"} detail={analysis ? "Listo" : "En curso"}/><i/><FlowStep number="03" title="Contexto PAM" state={pamDoc(snapshot) ? "complete" : "pending"} detail={pamDoc(snapshot) ? "Separado" : "Opcional"}/><i/><FlowStep number="04" title="Preinforme" state={analysis ? "current" : "pending"} detail={analysis ? "Disponible" : "Pendiente"}/></div></div><div className="developer-scope-card"><div><span className="card-kicker">ALCANCE ACTUAL</span><h3>Posibles desfragmentaciones del prestador</h3><p>Se revisan glosas, códigos, cantidades y vínculos dentro de la cuenta clínica. El PAM se conserva como contexto documental.</p></div><span>OPERATIVO</span></div><div className="dev-analysis-grid"><article><span className="card-kicker">CUENTA CLÍNICA</span><strong>{money(total)}</strong><small>Total informado por el prestador</small></article><article><span className="card-kicker">LÍNEAS CANDIDATAS</span><strong>{candidates.length}</strong><small>Requieren contraste técnico</small></article><article><span className="card-kicker">PRÓXIMA ACCIÓN</span><strong>{analysis ? "Exportar" : "Analizar"}</strong><small>{analysis ? "Preinforme del caso" : "Ejecutar motor"}</small></article></div><div className="developer-actions"><button className="portal-button portal-button-primary" onClick={onAnalyze} disabled={busy}>{busy ? "Procesando…" : analysis ? "Actualizar análisis" : "Abrir analizador"} →</button><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar preinforme</button><button className="portal-button portal-button-secondary" onClick={onClaimDraft}>Generar reclamo base</button></div><CorpusLearningPanel status={snapshot.corpusStatus} busy={busy} onStatus={onCorpusStatus}/>{analysis && <DeveloperAnalysisDetail analysis={analysis}/>}</div>; }
function CorpusLearningPanel({ status, busy, onStatus }: { status?: Snapshot["corpusStatus"]; busy: boolean; onStatus: (status: "pending_review" | "validated" | "rejected") => void }) { const label = status === "validated" ? "Activo en corpus" : status === "rejected" ? "No incorporado" : status === "pending_review" ? "Pendiente de validación" : "Sin observación registrada"; return <section className="corpus-learning-panel"><div><span className="card-kicker">APRENDIZAJE INCREMENTAL</span><h3>{label}</h3><p>Las cuentas y PAM nuevos se registran como observaciones. Solo una revisión humana los incorpora al corpus activo.</p></div><div className="corpus-learning-actions"><button className="portal-button portal-button-secondary" onClick={() => onStatus("validated")} disabled={busy || status === "validated"}>Validar aporte</button><button className="portal-button portal-button-secondary" onClick={() => onStatus("rejected")} disabled={busy || status === "rejected"}>Rechazar</button></div></section>; }

function DeveloperTraceability({ snapshot, onExport, onExportMarkdown }: { snapshot: Snapshot; onExport: () => void; onExportMarkdown: () => void }) { return <div className="traceability-view"><div className="traceability-toolbar"><div><span className="card-kicker">MATRIZ DE CUENTA CLÍNICA</span><h3>Evidencia línea por línea</h3></div><div className="traceability-toolbar-actions"><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar .json</button><button className="portal-button portal-button-secondary" onClick={onExportMarkdown}>Exportar .md</button></div></div>{snapshot.analysis ? <DeveloperAnalysisDetail analysis={snapshot.analysis}/> : <section className="trace-note"><span>i</span><p>Ejecuta el análisis desde Resumen para generar la matriz.</p></section>}</div>; }
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

function OperatingRoomScopePanel({ analysis }: { analysis: ClinicalAccountAnalysis }) {
  const framework = analysis.operatingRoomFramework ?? FULL_OPERATING_ROOM_FRAMEWORK;
  const active = analysis.lineAssessments.some((item) => item.candidates.some((candidate) => candidate.bundle === "operating_room"));
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

function DeveloperAnalysisDetail({ analysis }: { analysis: ClinicalAccountAnalysis }) { const rows = analysis.lineAssessments.filter((item) => !/bonificacion|copago|liquidacion|pam|ajuste/i.test(`${item.line.description} ${item.line.section || ""}`)); return <section className="developer-analysis-detail"><div className="developer-analysis-detail-head"><div><span className="card-kicker">ANÁLISIS DEL PRESTADOR</span><h3>Hipótesis técnicas trazables</h3><p>Estos resultados requieren contraste contractual y documental.</p></div><div className="developer-analysis-badges"><span>{rows.length} líneas en foco</span><span>{analysis.functionalEquivalenceAlerts?.length ?? 0} alertas funcionales</span></div></div><div className="developer-detail-metrics"><article><b>{rows.length}</b><small>Líneas en foco</small></article><article><b>{rows.filter((item) => item.candidates.length).length}</b><small>Con hipótesis</small></article><article><b>{money(rows.filter((item) => item.candidates.length).reduce((sum, item) => sum + item.line.amount, 0))}</b><small>Valor bajo hipótesis</small></article><article><b>{analysis.anomalies.length}</b><small>Señales</small></article></div><DeveloperBreakdownPanel analysis={analysis}/><AccountStructurePanel analysis={analysis}/><OperatingRoomScopePanel analysis={analysis}/><PrecedentProjectionPanel analysis={analysis} rows={rows}/><FunctionalEquivalencePanel analysis={analysis}/><ReasoningControlPanel analysis={analysis}/><div className="developer-line-table"><div className="developer-line-head"><span>Línea / origen</span><span>Hipótesis</span><span>Valor</span></div>{rows.map((item) => { const candidate = [...item.candidates].sort((left, right) => right.probability - left.probability)[0]; const precedent = item.precedentComparisons?.[0]; return <article key={item.line.id}><div><b>{item.line.description}</b><small>{item.line.section || "Sin sección"} · pág. {item.line.page}{item.line.code ? ` · código ${item.line.code}` : ""}</small></div><div><strong>{candidate ? `${Math.round(candidate.probability * 100)}%` : "Sin hipótesis"}</strong><small>{candidate?.reasons[0] || "Requiere clasificación adicional"}{precedent ? ` · Antecedente ${Math.round(precedent.comparability * 100)}% comparable` : ""}{candidate?.missingEvidence?.length ? ` · Falta: ${candidate.missingEvidence.join("; ")}` : ""}</small></div><b>{money(item.line.amount)}</b></article>; })}</div></section>; }
function FlowStep({ number, title, state, detail }: { number: string; title: string; state: "complete" | "current" | "pending"; detail: string }) { return <div className={state}><span>{number}</span><b>{title}</b><small>{detail}</small></div>; }
function DeveloperDocuments({ snapshot, busy, onFile }: { snapshot: Snapshot; busy: boolean; onFile: (file: File, classification: string) => void }) { return <div className="developer-documents"><div className="traceability-toolbar"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h3>Fuentes cargadas</h3></div><span className="document-replacement-note">Los archivos nuevos quedan vinculados al caso</span></div><div className="dev-document-grid"><OperationalDoc type="Cuenta clínica" document={accountDoc(snapshot)} classification="Cuenta clínica" busy={busy} onFile={onFile}/><OperationalDoc type="PAM / liquidación" document={pamDoc(snapshot)} classification="PAM / liquidación" busy={busy} onFile={onFile}/><OperationalDoc type="Contrato / plan" document={snapshot.documents.find((doc) => /contrato|plan/i.test(doc.classification))} classification="Contrato" busy={busy} onFile={onFile}/></div></div>; }
function OperationalDoc({ type, document, classification, busy, onFile }: { type: string; document?: CaseDocument; classification: string; busy: boolean; onFile: (file: File, classification: string) => void }) { const input = useRef<HTMLInputElement>(null); return <article className={`dev-doc ${document ? "" : "pending"}`}><span className="file-mark">{document ? "PDF" : "+"}</span><div><span>{type}</span><b>{document?.name || "Esperando archivo"}</b><small>{document ? `${document.extraction?.pageCount || "-"} páginas · extraído` : "Pendiente"}</small></div><button onClick={() => input.current?.click()} disabled={busy}>{document ? "Reemplazar" : "Cargar"}</button><input ref={input} hidden type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file, classification); }} /></article>; }
