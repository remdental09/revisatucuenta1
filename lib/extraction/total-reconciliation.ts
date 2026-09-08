import type { AccountTotalReconciliation, ExtractedLine, ExtractionField } from "./types.ts";

function parseAmount(value: string) {
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return Number.NaN;
  const unsigned = cleaned.replace(/^-/, "");
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(unsigned)) {
    const parsed = Number(unsigned.replace(/[.,]/g, ""));
    return cleaned.startsWith("-") ? -parsed : parsed;
  }
  const parsed = Number(unsigned.replace(/\./g, "").replace(",", "."));
  return cleaned.startsWith("-") ? -parsed : parsed;
}

export function reconcileAccountTotal(
  fields: Pick<ExtractionField, "key" | "value" | "label" | "sourceText">[],
  lines: Pick<ExtractedLine, "amount">[],
): AccountTotalReconciliation {
  const lineSum = Math.round(lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0));
  const totalField = fields.find((field) => field.key === "total");
  if (!totalField) return { status: "missing", basis: "none", lineSum };
  const printedTotal = Math.round(parseAmount(totalField.value));
  if (!Number.isFinite(printedTotal) || printedTotal <= 0) return { status: "missing", basis: "none", lineSum };
  const difference = Math.round(printedTotal - lineSum);
  const tolerance = Math.max(1_000, Math.round(printedTotal * 0.01));
  const basis = /suma\s+columna\s+valor|total\s+empresa/i.test(`${totalField.label} ${totalField.sourceText || ""}`)
    ? "entity_totals"
    : "printed_total";
  return {
    status: Math.abs(difference) <= tolerance ? "verified" : "mismatch",
    basis,
    printedTotal,
    lineSum,
    difference,
    tolerance,
    entityCount: basis === "entity_totals" ? (totalField.sourceText?.split("|").filter(Boolean).length || undefined) : undefined,
  };
}
