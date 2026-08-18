import {
  analyzeClinicalAccount,
  type ChileanBillingLine,
} from "../../../lib/rules/chilean-account.ts";

type AnalysisRequest = { lines?: unknown };

function isBillingLine(value: unknown): value is ChileanBillingLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === "string" &&
    line.id.length > 0 &&
    typeof line.description === "string" &&
    line.description.length > 0 &&
    typeof line.amount === "number" &&
    Number.isFinite(line.amount) &&
    typeof line.page === "number" &&
    Number.isInteger(line.page) &&
    line.page > 0
  );
}

/**
 * Receives line items already extracted from a clinical account. PDF/OCR
 * extraction is intentionally a separate step so every conclusion can retain
 * its source page and the original document identifier.
 */
export async function POST(request: Request) {
  let body: AnalysisRequest;
  try {
    body = (await request.json()) as AnalysisRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON inválida" }, { status: 400 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return Response.json({ error: "La cuenta no contiene líneas analizables" }, { status: 400 });
  }
  if (body.lines.length > 10_000) {
    return Response.json({ error: "La cuenta excede el máximo de 10.000 líneas" }, { status: 413 });
  }
  if (!body.lines.every(isBillingLine)) {
    return Response.json(
      { error: "Cada línea requiere id, glosa, monto numérico y página de origen" },
      { status: 422 },
    );
  }

  return Response.json(analyzeClinicalAccount(body.lines));
}
