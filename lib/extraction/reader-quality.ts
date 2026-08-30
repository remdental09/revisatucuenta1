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

function numericIssues(lines: Array<{
  description: string;
  page: number;
  quantity?: number;
  unitAmount?: number;
  amount: number;
  numericReconciled?: boolean;
}>) {
  const items: ReaderUnknownItem[] = [];
  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitAmount) || !Number.isFinite(line.amount)) continue;
    if ((line.quantity ?? 0) <= 0 || (line.unitAmount ?? 0) <= 0) continue;
    const expected = Math.round((line.quantity ?? 0) * (line.unitAmount ?? 0));
    const difference = Math.abs(Math.round(line.amount) - expected);
    const tolerance = Math.max(1, Math.round(expected * 0.01));
    if (difference <= tolerance) continue;
    items.push({
      value: `${line.description.slice(0, 90)} · total ${Math.round(line.amount)} vs. cantidad × unitario ${expected}`,
      page: line.page,
      reason: "La cantidad, el valor unitario y el total no concilian; puede existir una columna mal leída o un recargo que debe verificarse en el documento original.",
      confidence: 0.22,
    });
  }
  return items.slice(0, 30);
}

function parseChileanAmount(value: string) {
  const normalized = value.replace(/[^0-9,.-]/g, "");
  if (!normalized) return Number.NaN;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) return Number(normalized.replace(/[.,]/g, ""));
  return Number(normalized.replace(/\./g, "").replace(",", "."));
}

function documentTotalIssue(
  fields: Array<{ key: string; value: string; page: number }>,
  lines: Array<{ amount: number }>,
) {
  const totalField = fields.find((field) => field.key === "total");
  if (!totalField || !lines.length) return;
  const printedTotal = parseChileanAmount(totalField.value);
  const extractedTotal = Math.round(lines.reduce((sum, line) => sum + line.amount, 0));
  if (!Number.isFinite(printedTotal) || printedTotal <= 0) return;
  const difference = Math.abs(Math.round(printedTotal) - extractedTotal);
  const tolerance = Math.max(1_000, Math.round(printedTotal * 0.01));
  if (difference <= tolerance) return;
  return {
    value: `Total impreso ${Math.round(printedTotal)} vs. suma de líneas extraídas ${extractedTotal}`,
    page: totalField.page,
    reason: "La suma de los renglones no concilia con el total informado por el prestador; puede haber filas omitidas, duplicadas o columnas OCR mal interpretadas.",
    confidence: 0.2,
  } satisfies ReaderUnknownItem;
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
  const lineNumericIssues = numericIssues(lines);
  const totalIssue = kind === "account" ? documentTotalIssue(fields, lines) : undefined;
  const numeric = totalIssue ? [...lineNumericIssues, totalIssue] : lineNumericIssues;
  const reconciledCount = lines.filter((line) => line.numericReconciled).length;
  const unresolvedPages = (extraction.pageKinds ?? []).filter((page) => page.kind === "unknown");
  const recognizedMixedDocument = Boolean(
    extraction.account && extraction.pam && extraction.pageKinds?.length && unresolvedPages.length === 0,
  );
  const lowConfidencePages = [...new Set([...unknown, ...numeric].map((item) => item.page))].sort((left, right) => left - right);
  const signals: string[] = [];
  const parserMode = recognizedMixedDocument
    ? "mixed"
    : extraction.usedOcr
    ? extraction.ocrPages && extraction.ocrPages.length > 0 && extraction.ocrPages.length < extraction.pageCount
      ? "mixed"
      : "ocr"
    : "direct_pdf";

  if (!extraction.pageCount) signals.push("El archivo no informó páginas legibles.");
  if (extraction.usedOcr) signals.push("Se utilizó OCR porque el PDF no entregó texto suficiente.");
  if (extraction.ocrEnhancements?.length) signals.push(`Se aplicó una segunda pasada OCR amplificada en ${extraction.ocrEnhancements.length} página(s) dudosa(s), conservando la lectura primaria para comparación.`);
  if (recognizedMixedDocument) signals.push("El archivo contenía cuenta clínica y PAM; ambos bloques fueron separados y se analizan como fuentes independientes.");
  if (!source) signals.push(`No se identificó una estructura de ${kind === "unknown" ? "cuenta o PAM" : kind}.`);
  if (!lines.length) signals.push("No se reconocieron líneas monetarias analizables.");
  if (unknown.length && lines.length) signals.push("Existen glosas que requieren revisión del lector.");
  if (numeric.length) signals.push("Se detectaron inconsistencias entre cantidad, valor unitario y total; el diagnóstico no debe darse por válido sin revisar esas filas.");
  if (reconciledCount) signals.push(`Se corrigieron ${reconciledCount} totales OCR únicamente cuando cantidad × valor unitario mostró una pérdida inequívoca de dígitos.`);
  if (kind === "account" && lines.length > 0 && !fields.some((field) => field.key === "total")) {
    signals.push("No se encontró un total explícito; el total no debe inferirse sin revisión.");
  }
  if (pages.length && pages.length < extraction.pageCount && !recognizedMixedDocument) {
    signals.push("No todas las páginas quedaron asociadas al tipo documental esperado.");
  }
  if (unresolvedPages.length) signals.push(`${unresolvedPages.length} páginas no pudieron clasificarse con seguridad como cuenta o PAM.`);

  let confidence = 0.15;
  if (extraction.pageCount > 0) confidence += 0.2;
  if (source) confidence += 0.2;
  if (lines.length > 0) confidence += Math.min(0.28, lines.length >= 5 ? 0.28 : lines.length * 0.055);
  if (fields.length > 0) confidence += Math.min(0.12, fields.length * 0.025);
  if (extraction.usedOcr) confidence -= 0.1;
  confidence -= Math.min(0.08, reconciledCount * 0.01);
  confidence -= Math.min(0.25, unknown.length * 0.06);
  confidence -= Math.min(0.25, numeric.length * 0.05);
  if (kind === "account" && lines.length > 0 && !fields.some((field) => field.key === "total")) confidence -= 0.08;
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  const codeChangeNeeded = !source || !lines.length || unknown.length >= 3 || numeric.length >= 2 || unresolvedPages.length > 0 || (extraction.pageCount > 1 && pages.length < extraction.pageCount && !recognizedMixedDocument);
  const status = codeChangeNeeded
    ? "reader_change_needed"
    : signals.length || extraction.usedOcr || unknown.length
      ? "review_required"
      : "ready";
  const fingerprintInput = [
    kind,
    extraction.pageCount,
    parserMode,
    pages.length,
    lines.length,
    fields.map((field) => field.key).sort().join(","),
    lines.slice(0, 20).map((line) => `${line.code ?? ""}:${normalize(line.description).slice(0, 36)}`).join("|"),
  ].join(";");

  return {
    status,
    parserMode,
    confidence: Number(confidence.toFixed(2)),
    templateFingerprint: `shape-${stableHash(fingerprintInput)}`,
    unknownItems: unknown,
    numericIssues: numeric,
    lowConfidencePages,
    signals: signals.length ? signals : ["La estructura produjo líneas y campos utilizables para una revisión preliminar."],
    nextAction: codeChangeNeeded
      ? "Revisar el formato y preparar un ajuste del lector antes de usar el resultado como base operativa."
      : "Mantener el resultado bajo revisión humana y contrastarlo con el documento original.",
    codeChangeNeeded,
    llmAssist: {
      status: "not_attempted",
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
  numericIssues: ReaderUnknownItem[];
  llmAssist: ReaderAssessment["llmAssist"];
  safetyBoundary: string;
};

export function buildReaderChangeProposal(assessment: ReaderAssessment, documentName: string): ReaderChangeProposal {
  const numeric = assessment.numericIssues ?? [];
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
    numericIssues: numeric,
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
    "## Inconsistencias numéricas",
    "",
    ...(proposal.numericIssues.length
      ? proposal.numericIssues.map((item) => `- Página ${item.page}: ${item.value} — ${item.reason}`)
      : ["- No se detectaron diferencias entre cantidad, valor unitario y total."]),
    "",
    "## LLM",
    "",
    `- Estado: ${proposal.llmAssist.status === "not_attempted" ? "pendiente de ejecución" : proposal.llmAssist.status}`,
    `- Rol: ${proposal.llmAssist.role}`,
    `- Contrato: ${proposal.llmAssist.contractVersion}`,
    "",
    `> ${proposal.safetyBoundary}`,
    "",
  ].join("\n");
}

/**
 * Creates a self-contained handoff for a human reviewer using an external
 * LLM. It deliberately contains only the extraction evidence already stored
 * in the case; it never sends the document or its medical data anywhere.
 */
export type ReaderReviewPackage = {
  packageVersion: string;
  generatedAt: string;
  documentName: string;
  readerAssessment: ReaderAssessment;
  extracted: {
    fields: DocumentExtraction["account"] extends infer Account
      ? Account extends { fields: infer Fields } ? Fields : never
      : never;
    lines: DocumentExtraction["account"] extends infer Account
      ? Account extends { lines: infer Lines } ? Lines : never
      : never;
  };
  instructions: string[];
  safetyBoundary: string;
};

export function buildReaderReviewPackage(documentName: string, extraction: DocumentExtraction): ReaderReviewPackage {
  const account = extraction.account;
  const assessment = extraction.readerAssessment ?? assessExtractionQuality(extraction, account ? "account" : "unknown");
  return {
    packageVersion: `${CONTRACT_VERSION}-handoff`,
    generatedAt: new Date().toISOString(),
    documentName,
    readerAssessment: assessment,
    extracted: {
      fields: account?.fields ?? [],
      lines: account?.lines ?? [],
    },
    instructions: [
      "Revisar el documento original junto con esta evidencia, página por página.",
      "Corregir sólo errores de lectura claramente demostrables y conservar el texto original.",
      "No convertir una hipótesis técnica en una conclusión legal o de cobertura.",
      "Devolver una lista de correcciones propuestas y su evidencia; la aceptación debe ser humana y versionada.",
    ],
    safetyBoundary: "Este paquete es una ayuda de revisión. No modifica código, no publica reglas y no determina devoluciones ni pertenencia a Día Cama o Pabellón.",
  };
}

export function readerReviewPackageToMarkdown(review: ReaderReviewPackage) {
  const fields = review.extracted.fields.map((field) =>
    `| ${field.label} | ${field.value} | pág. ${field.page} | ${Math.round(field.confidence)}% | ${field.sourceText ?? "—"} |`,
  );
  const lines = review.extracted.lines.map((line, index) =>
    `| ${index + 1} | ${line.page} | ${line.code ?? "—"} | ${line.description} | ${Math.round(line.amount)} | ${line.sourceText ?? "—"} |`,
  );
  return [
    `# Revisión asistida de lectura: ${review.documentName}`,
    "",
    `- Paquete: ${review.packageVersion}`,
    `- Generado: ${review.generatedAt}`,
    `- Estado del lector: ${review.readerAssessment.status}`,
    `- Ruta: ${review.readerAssessment.parserMode}`,
    `- Confianza global: ${Math.round(review.readerAssessment.confidence * 100)}%`,
    `- Huella de formato: ${review.readerAssessment.templateFingerprint}`,
    "",
    "## Instrucciones para la revisión humana o LLM externo",
    "",
    ...review.instructions.map((instruction) => `- ${instruction}`),
    "",
    "## Campos extraídos",
    "",
    "| Campo | Valor | Página | Confianza | Texto de origen |",
    "|---|---|---:|---:|---|",
    ...(fields.length ? fields : ["| — | No se extrajeron campos | — | — | — |"]),
    "",
    "## Líneas extraídas",
    "",
    "| # | Página | Código | Glosa | Monto | Texto de origen |",
    "|---:|---:|---|---|---:|---|",
    ...(lines.length ? lines : ["| — | — | — | No se reconocieron líneas monetarias | — | — |"]),
    "",
    "## Señales y elementos dudosos",
    "",
    ...review.readerAssessment.signals.map((signal) => `- ${signal}`),
    ...review.readerAssessment.unknownItems.map((item) => `- Página ${item.page}: ${item.value} — ${item.reason}`),
    ...review.readerAssessment.numericIssues.map((item) => `- Página ${item.page}: ${item.value} — ${item.reason}`),
    "",
    `> ${review.safetyBoundary}`,
    "",
  ].join("\n");
}
