import type { DocumentExtraction, ReaderAssessment, ReaderUnknownItem } from "./types";

type ReaderKind = "account" | "pam" | "unknown";

const CONTRACT_VERSION = "reader-change-v1";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function suspiciousDescription(description: string) {
  const normalized = description.trim();
  return normalized.includes("�") ||
    !/[a-záéíóúñ]/i.test(normalized) ||
    (/\S{28,}/.test(normalized) && !/[\s-]/.test(normalized));
}

function kindFromExtraction(extraction: DocumentExtraction, expectedKind: ReaderKind) {
  if (expectedKind !== "unknown") return expectedKind;
  if (extraction.account && !extraction.pam) return "account";
  if (extraction.pam && !extraction.account) return "pam";
  return extraction.account ? "account" : extraction.pam ? "pam" : "unknown";
}

function unknownItems(extraction: DocumentExtraction, lines: Array<{ description: string; page: number }>) {
  const items: ReaderUnknownItem[] = [];
  for (const line of lines) {
    if (!suspiciousDescription(line.description)) continue;
    items.push({
      value: line.description.slice(0, 120),
      page: line.page,
      reason: "La glosa contiene señales compatibles con OCR incompleto o un formato no reconocido.",
      confidence: 0.28,
    });
  }
  if (!lines.length) {
    items.push({
      value: "No se reconocieron líneas monetarias",
      page: 1,
      reason: "El lector no produjo renglones analizables para el tipo de documento esperado.",
      confidence: 0.12,
    });
  }
  return items.slice(0, 30);
}

export function assessExtractionQuality(
  extraction: DocumentExtraction,
  expectedKind: ReaderKind,
): ReaderAssessment {
  const kind = kindFromExtraction(extraction, expectedKind);
  const source = kind === "account" ? extraction.account : kind === "pam" ? extraction.pam : undefined;
  const lines = source?.lines ?? [];
  const pages = source?.pages ?? [];
  const fields = source?.fields ?? [];
  const unknown = unknownItems(extraction, lines);
  const lowConfidencePages = [...new Set(unknown.map((item) => item.page))].sort((left, right) => left - right);
  const signals: string[] = [];

  if (!extraction.pageCount) signals.push("El archivo no informó páginas legibles.");
  if (extraction.usedOcr) signals.push("Se utilizó OCR porque el PDF no entregó texto suficiente.");
  if (!source) signals.push(`No se identificó una estructura de ${kind === "unknown" ? "cuenta o PAM" : kind}.`);
  if (!lines.length) signals.push("No se reconocieron líneas monetarias analizables.");
  if (unknown.length && lines.length) signals.push("Existen glosas que requieren revisión del lector.");
  if (kind === "account" && lines.length > 0 && !fields.some((field) => field.key === "total")) {
    signals.push("No se encontró un total explícito; el total no debe inferirse sin revisión.");
  }
  if (pages.length && pages.length < extraction.pageCount) {
    signals.push("No todas las páginas quedaron asociadas al tipo documental esperado.");
  }

  let confidence = 0.15;
  if (extraction.pageCount > 0) confidence += 0.2;
  if (source) confidence += 0.2;
  if (lines.length > 0) confidence += Math.min(0.28, lines.length >= 5 ? 0.28 : lines.length * 0.055);
  if (fields.length > 0) confidence += Math.min(0.12, fields.length * 0.025);
  if (extraction.usedOcr) confidence -= 0.1;
  confidence -= Math.min(0.25, unknown.length * 0.06);
  if (kind === "account" && lines.length > 0 && !fields.some((field) => field.key === "total")) confidence -= 0.08;
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  const codeChangeNeeded = !source || !lines.length || unknown.length >= 3 || (extraction.pageCount > 1 && pages.length < extraction.pageCount);
  const status = codeChangeNeeded
    ? "reader_change_needed"
    : signals.length || extraction.usedOcr || unknown.length
      ? "review_required"
      : "ready";
  const fingerprintInput = [
    kind,
    extraction.pageCount,
    extraction.usedOcr ? "ocr" : "direct",
    pages.length,
    lines.length,
    fields.map((field) => field.key).sort().join(","),
    lines.slice(0, 20).map((line) => `${line.code ?? ""}:${normalize(line.description).slice(0, 36)}`).join("|"),
  ].join(";");

  return {
    status,
    parserMode: extraction.usedOcr ? "ocr" : "direct_pdf",
    confidence: Number(confidence.toFixed(2)),
    templateFingerprint: `shape-${stableHash(fingerprintInput)}`,
    unknownItems: unknown,
    lowConfidencePages,
    signals: signals.length ? signals : ["La estructura produjo líneas y campos utilizables para una revisión preliminar."],
    nextAction: codeChangeNeeded
      ? "Revisar el formato y preparar un ajuste del lector antes de usar el resultado como base operativa."
      : "Mantener el resultado bajo revisión humana y contrastarlo con el documento original.",
    codeChangeNeeded,
    llmAssist: {
      status: "not_configured",
      role: "assistive_only",
      contractVersion: CONTRACT_VERSION,
    },
  };
}

export type ReaderChangeProposal = {
  proposalVersion: string;
  status: "pending_human_review";
  generatedAt: string;
  templateFingerprint: string;
  title: string;
  reason: string;
  proposedChanges: Array<{ area: string; change: string; acceptanceTest: string }>;
  unknownItems: ReaderUnknownItem[];
  llmAssist: ReaderAssessment["llmAssist"];
  safetyBoundary: string;
};

export function buildReaderChangeProposal(assessment: ReaderAssessment, documentName: string): ReaderChangeProposal {
  return {
    proposalVersion: CONTRACT_VERSION,
    status: "pending_human_review",
    generatedAt: new Date().toISOString(),
    templateFingerprint: assessment.templateFingerprint,
    title: `Propuesta de ajuste del lector: ${documentName}`,
    reason: assessment.signals.join(" "),
    proposedChanges: [
      {
        area: "Parser de filas",
        change: "Revisar la separación de columnas, códigos, glosas y montos en las páginas señaladas antes de cambiar las expresiones de lectura.",
        acceptanceTest: "La cuenta se vuelve a leer con sus líneas, páginas y montos conciliados contra el PDF original.",
      },
      {
        area: "OCR / formato",
        change: assessment.parserMode === "ocr" ? "Comparar el OCR con una renderización de mayor resolución y conservar las glosas originales." : "Agregar una variante de plantilla sin alterar los formatos ya reconocidos.",
        acceptanceTest: "El lector conserva el resultado anterior en cuentas conocidas y reconoce el nuevo formato en una prueba aislada.",
      },
      {
        area: "Asistencia LLM",
        change: "Usar el LLM sólo para sugerir campos o reglas a partir de este contexto; la aceptación debe ser humana y versionada.",
        acceptanceTest: "Ninguna sugerencia del LLM modifica código ni publica una regla automáticamente.",
      },
    ],
    unknownItems: assessment.unknownItems,
    llmAssist: assessment.llmAssist,
    safetyBoundary: "Esta propuesta no es una conclusión legal, no modifica el lector y no se despliega automáticamente.",
  };
}

export function readerChangeProposalToMarkdown(proposal: ReaderChangeProposal) {
  return [
    `# ${proposal.title}`,
    "",
    `- Estado: ${proposal.status}`,
    `- Versión: ${proposal.proposalVersion}`,
    `- Huella de formato: ${proposal.templateFingerprint}`,
    `- Generada: ${proposal.generatedAt}`,
    "",
    "## Motivo",
    "",
    proposal.reason,
    "",
    "## Cambios sugeridos",
    "",
    "| Área | Propuesta | Prueba de aceptación |",
    "|---|---|---|",
    ...proposal.proposedChanges.map((item) => `| ${item.area} | ${item.change} | ${item.acceptanceTest} |`),
    "",
    "## Elementos no reconocidos o dudosos",
    "",
    ...(proposal.unknownItems.length
      ? proposal.unknownItems.map((item) => `- Página ${item.page}: ${item.value} — ${item.reason}`)
      : ["- No se detectaron elementos puntuales; la propuesta puede responder a una baja cobertura del formato."]),
    "",
    "## LLM",
    "",
    `- Estado: ${proposal.llmAssist.status}`,
    `- Rol: ${proposal.llmAssist.role}`,
    `- Contrato: ${proposal.llmAssist.contractVersion}`,
    "",
    `> ${proposal.safetyBoundary}`,
    "",
  ].join("\n");
}
