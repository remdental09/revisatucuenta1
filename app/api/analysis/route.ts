import {
  analyzeClinicalAccount,
  type ChileanBillingLine,
} from "../../../lib/rules/chilean-account.ts";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localSaveAnalysis } from "../../../lib/server/runtime-store.ts";
import {
  buildCorpusContribution,
  getObservedCorpusSnapshot,
  registerCorpusContribution,
} from "../../../lib/server/observed-corpus-store.ts";

type AnalysisRequest = { caseId?: string; episodeLabel?: string; lines?: unknown };

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

  const env = await getCloudflareEnv();
  const corpusSnapshot = await getObservedCorpusSnapshot(env);
  const analysis = analyzeClinicalAccount(body.lines, undefined, corpusSnapshot.corpus);
  analysis.observedCorpus.pendingContributionCount = corpusSnapshot.pendingCount;
  analysis.observedCorpus.validatedContributionCount = corpusSnapshot.validatedCount;
  analysis.corpusLearning = {
    status: "not_registered",
    message: "Esta ejecución no se vinculó a un expediente para incorporación al corpus.",
  };
  if (body.caseId) {
    const contribution = buildCorpusContribution({
      caseId: body.caseId,
      episodeClass: body.episodeLabel,
      sourceKind: "account",
      sourceDocumentId: body.lines[0]?.documentId,
      lines: body.lines,
    });
    const corpusStatus = await registerCorpusContribution(env, body.caseId, contribution);
    const nextSnapshot = await getObservedCorpusSnapshot(env);
    analysis.observedCorpus.pendingContributionCount = nextSnapshot.pendingCount;
    analysis.observedCorpus.validatedContributionCount = nextSnapshot.validatedCount;
    analysis.corpusLearning = {
      status: corpusStatus,
      message: corpusStatus === "validated"
        ? "La cuenta ya está incorporada como observación validada del corpus."
        : "La cuenta quedó como observación pendiente. Se incorporará al corpus activo después de revisión interna.",
    };
    if (!env?.DB) {
      localSaveAnalysis(body.caseId, analysis);
      return Response.json(analysis);
    }
    await ensureCaseSchema(env.DB);
    await env.DB.prepare(`INSERT INTO case_analyses (id, case_id, analysis_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(case_id) DO UPDATE SET analysis_json = excluded.analysis_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), body.caseId, JSON.stringify(analysis)).run();
    await env.DB.prepare(`UPDATE cases SET status = 'analysis_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.caseId).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), body.caseId, "Análisis completado", "La cuenta clínica quedó clasificada y trazable por línea.").run();
  }
  return Response.json(analysis);
}
