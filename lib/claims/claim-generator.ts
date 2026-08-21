import type { ClinicalAccountAnalysis } from "../rules/chilean-account.ts";
import {
  EQUALITY_PROJECTION_FRAMEWORK,
  FULL_OPERATING_ROOM_FRAMEWORK,
  UNIVERSAL_CLAIM_FRAMEWORK,
  UNIVERSAL_CLAIM_LEGAL_BASIS,
} from "./legal-basis.ts";

export type ClaimDraftInput = {
  caseId?: string;
  patientName?: string;
  episodeLabel?: string;
  providerName?: string;
  analysis?: ClinicalAccountAnalysis;
};

function markdownCell(value: unknown) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function itemRows(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.lineAssessments ?? [])
    .filter((assessment) => assessment.candidates.length > 0)
    .map((assessment) => {
      const candidate = [...assessment.candidates].sort(
        (left, right) => right.probability - left.probability,
      )[0];
      return `| ${markdownCell(assessment.line.description)} | ${markdownCell(assessment.line.section || "Sin rubro identificado")} | ${Math.round((candidate?.probability ?? 0) * 100)}% | ${Math.round(assessment.line.amount).toLocaleString("es-CL")} |`;
    });
}

function precedentRows(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.lineAssessments ?? [])
    .flatMap((assessment) =>
      (assessment.precedentComparisons ?? []).map((comparison) => ({ assessment, comparison })),
    )
    .filter(({ comparison }) => comparison.status !== "not_comparable")
    .map(({ assessment, comparison }) =>
      `| ${markdownCell(assessment.line.description)} | ${markdownCell(comparison.label)} | ${markdownCell(comparison.outcomeLabel)} | ${Math.round(comparison.comparability * 100)}% | ${markdownCell(comparison.status)} |`,
    );
}

function reasoningRows(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.reasoningFindings ?? [])
    .filter((finding) => finding.status !== "not_triggered")
    .map(
      (finding) =>
        `| ${markdownCell(finding.status)} | ${markdownCell(finding.title)} | ${markdownCell(finding.action)} | ${markdownCell(finding.sourceReferences.join("; "))} |`,
    );
}

function functionalAlertRows(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.functionalEquivalenceAlerts ?? []).map(
    (alert) =>
      `| ${markdownCell(alert.lineDescription)} | ${markdownCell(alert.familyLabel)} | ${markdownCell(alert.targetBundles.join(" / "))} | ${markdownCell(alert.alertLevel)} / ${Math.round(alert.comparability * 100)}% | ${markdownCell(alert.evidenceToRequest.join("; "))} |`,
  );
}

/**
 * Creates a clarification-first draft. It never states that a charge is
 * improper; it asks the responsible institution to disclose its composition,
 * classification and contractual basis before any escalation.
 */
export function generateClarificationClaimMarkdown(input: ClaimDraftInput) {
  const rows = itemRows(input.analysis);
  const precedentEvidence = precedentRows(input.analysis);
  const reasoningEvidence = reasoningRows(input.analysis);
  const functionalEvidence = functionalAlertRows(input.analysis);
  const framework = input.analysis?.claimFramework ?? UNIVERSAL_CLAIM_FRAMEWORK;
  const equality = input.analysis?.equalityProjection ?? EQUALITY_PROJECTION_FRAMEWORK;
  const operatingRoom = input.analysis?.operatingRoomFramework ?? FULL_OPERATING_ROOM_FRAMEWORK;
  const caseLabel = input.caseId ? ` — Expediente ${input.caseId}` : "";

  return [
    `# Solicitud de aclaración y revisión de cuenta${caseLabel}`,
    "",
    `- Paciente: ${input.patientName || "Por completar"}`,
    `- Prestador: ${input.providerName || "Por completar"}`,
    `- Episodio: ${input.episodeLabel || "Por completar"}`,
    "",
    "> Este borrador es una solicitud inicial de información. No afirma por sí mismo la existencia de un cobro improcedente ni una devolución garantizada.",
    "",
    "## Fundamento común aplicable a cualquier ítem o rubro",
    "",
    UNIVERSAL_CLAIM_LEGAL_BASIS,
    "",
    `- Versión del fundamento: ${framework.version}`,
    `- Aplicación: ${framework.appliesTo}`,
    `- Artículos considerados: ${framework.articles.join(", ")}`,
    "",
    "## Solicitud de aclaración",
    "",
    "Solicito emitir una cuenta clínica actualizada, pormenorizada y ordenada según la naturaleza de cada cobro, indicando para cada concepto su nombre o glosa, código, fecha, cantidad, valor unitario, valor total y rubro.",
    "",
    "Solicito además informar qué prestaciones, cuidados, procedimientos, materiales, insumos y medicamentos se encuentran comprendidos dentro de los cargos principales de hospitalización o de la prestación respectiva, y explicar el fundamento de todo concepto cobrado separadamente.",
    "",
    "Solicito separar medicamentos de materiales e insumos clínicos, identificar la prestación o atención a la cual se asocia cada uno e informar las unidades efectivamente utilizadas, anuladas, devueltas o ajustadas.",
    "",
    "## Alcance integral del Derecho de Pabellón, si corresponde",
    "",
    operatingRoom.sourceRule,
    "",
    "Si el episodio incluyó pabellón, solicito identificar cada cargo facturado separadamente que corresponda a sala o recuperación, equipos o elementos no fungibles, insumos desechables o recuperables, fungibles generales, gases o anestésicos. Respecto de cada uno, solicito indicar la diferencia objetiva, el código, el registro de uso y la regla del contrato, convenio o arancel que fundamentaría su cobro fuera del Derecho de Pabellón.",
    "",
    `Fuentes de contraste: ${operatingRoom.sourceReferences.join("; ")}.`,
    "",
    "> Esta solicitud plantea una presunción técnica de revisión. No afirma por sí sola que el cargo sea improcedente ni que exista una devolución automática.",
    "",
    "## Antecedente comparable e igualdad ante la ley",
    "",
    equality.constitutionalBasis,
    "",
    equality.projectionRule,
    "",
    precedentEvidence.length
      ? [
          "El motor detectó los siguientes antecedentes comparables, que se solicitan verificar y aplicar consistentemente:",
          "",
          "| Concepto de la cuenta | Antecedente | Resultado en el caso fuente | Comparabilidad | Estado |",
          "|---|---|---|---:|---|",
          ...precedentEvidence,
          "",
    ].join("\n")
      : "No se detectó aún un antecedente comparable; la comparación podrá completarse cuando se incorpore una decisión o resolución pertinente.",
    "Solicito que, si la institución se aparta del criterio aplicado en un antecedente materialmente equivalente, indique la diferencia objetiva, contractual o técnica que justifica el tratamiento distinto.",
    "",
    "## Alertas de equivalencia funcional para aclarar",
    "",
    "El motor detectó productos o atenciones que pueden cumplir una función semejante a insumos clasificados en Día Cama, Medicamentos Hospitalizados o Derecho de Pabellón en antecedentes revisados. Solicito informar, para cada uno, su función clínica, lugar de uso, prestación principal, registro de administración o consumo y fundamento contractual del cobro separado.",
    "",
    functionalEvidence.length
      ? [
          "| Concepto | Familia funcional | Destino posible | Nivel / comparabilidad | Evidencia solicitada |",
          "|---|---|---|---:|---|",
          ...functionalEvidence,
          "",
        ].join("\n")
      : "No se activaron alertas funcionales; completar con el detalle de la cuenta.",
    "",
    "## Criterios adicionales de control derivados de jurisprudencia y compendios",
    "",
    "Los siguientes criterios se incorporan para que la respuesta no se limite a clasificar un producto: también debe explicar codificación, integralidad, exclusiones, modalidad de pago, presupuesto y procedimiento.",
    "",
    reasoningEvidence.length
      ? [
          "| Estado | Criterio | Petición operativa | Fuente |",
          "|---|---|---|---|",
          ...reasoningEvidence,
          "",
        ].join("\n")
      : "No se activaron todavía criterios adicionales; completar con la cuenta y los documentos del episodio.",
    "",
    "## Líneas que el motor recomienda contrastar",
    "",
    "| Concepto | Rubro informado | Probabilidad técnica | Monto |",
    "|---|---|---:|---:|",
    ...(rows.length ? rows : ["| No hay líneas con hipótesis técnica; completar con el detalle de la cuenta. | — | — | — |"]),
    "",
    "## Respuesta solicitada",
    "",
    "Solicito que la respuesta sea entregada por escrito, identificando la unidad responsable y citando la documentación, tarifa, convenio, contrato o registro de uso que respalde cada clasificación y cobro.",
    "",
    "Si la respuesta no permite verificar la composición, clasificación y fundamento de los cargos, se evaluará continuar el ciclo de aclaración ante la Isapre y, si corresponde, ante la Superintendencia de Salud.",
    "",
  ].join("\n");
}
