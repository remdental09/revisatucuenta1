import type { DocumentExtraction, ExtractionField } from "./types";

export function extractedPatientField(extraction: DocumentExtraction): ExtractionField | undefined {
  const field = extraction.account?.fields.find((candidate) => candidate.key === "patient");
  if (!field || field.confidence < 85 || field.value.trim().length < 5) return;
  return field;
}

export function isPlaceholderPatientName(value: string | undefined) {
  return !value || /^(?:paciente(?:\s+prueba)?|sin\s+informar|no\s+informado)$/i.test(value.trim());
}
