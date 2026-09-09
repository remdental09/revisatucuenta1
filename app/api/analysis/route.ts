import {
  analyzeClinicalAccount,
  type ChileanBillingLine,
} from "../../../lib/rules/chilean-account.ts";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localSaveAnalysis } from "../../../lib/server/runtime-store.ts";
import { getObservedCorpusSnapshot } from "../../../lib/server/observed-corpus-store.ts";
import { isDeveloperUser, requireApiUser } from "../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../lib/server/case-access.ts";
import { buildPatientResult } from "../../../lib/rules/patient-result.ts";
import type { AccountTotalReconciliation, ReaderAssessment } from "../../../lib/extraction/types.ts";
import { ReaderAssistError } from "../../../lib/server/openai-reader-assist.ts";
import { requestAnalysisAssist } from "../../../lib/server/openai-analysis-assist.ts";

type AnalysisRequest = {
  caseId?: string;
  episodeLabel?: string;
  lines?: unknown;
  pamLines?: unknown;
  readerAssessment?: ReaderAssessment;
  printedTotal?: number;
  pamPrintedTotal?: number;
  totalReconciliation?: AccountTotalReconciliation;
  /**
   * Patient mode may request a preliminary result when the reader has
   * extracted usable lines but the printed total still needs reconciliation.
   * The developer console deliberately omits this flag and keeps the strict
   * integrity gate below.
   */
  allowPreliminaryAnalysis?: boolean;
};

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
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
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
  if (body.pamLines !== undefined && (!Array.isArray(body.pamLines) || !body.pamLines.every(isBillingLine))) {
    return Response.json(
      { error: "Cada línea del PAM requiere id, glosa, monto numérico y página de origen" },
      { status: 422 },
    );
  }
  if (Array.isArray(body.pamLines) && body.pamLines.length > 10_000) {
    return Response.json({ error: "El PAM excede el máximo de 10.000 líneas" }, { status: 413 });
  }

  // Persisted account results require an explicit printed total and an
  // independent reconciliation against every extracted row. Direct rule
  // probes without a caseId remain available for development.
  if (body.caseId && body.readerAssessment && !body.allowPreliminaryAnalysis) {
    const printedTotal = Number.isFinite(body.printedTotal) ? Math.round(body.printedTotal as number) : 0;
    const lineSum = Math.round((body.lines as ChileanBillingLine[]).reduce((sum, line) => sum + line.amount, 0));
    const tolerance = Math.max(1_000, Math.round(printedTotal * 0.01));
    if (!printedTotal || !body.totalReconciliation || body.totalReconciliation.status !== "verified" || Math.abs(printedTotal - lineSum) > tolerance) {
      return Response.json({
        code: "ACCOUNT_TOTAL_NOT_RECONCILED",
        error: "La cuenta no puede analizarse todavía: el total impreso y la suma de todas las líneas no concilian. Revisa el OCR o solicita GPT Vision.",
        printedTotal: printedTotal || null,
        lineSum,
        tolerance,
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
  }

  const env = await getCloudflareEnv();
  // Keep the provider configuration observable without ever logging the
  // secret itself.  This distinguishes a missing runtime variable from a
  // provider rejection (401/403) and avoids the misleading "not configured"
  // state when a deployment was built before its environment was refreshed.
  const runtimeApiKey = typeof process !== "undefined" ? process.env.OPENAI_API_KEY?.trim() : undefined;
  console.info("[analysis] LLM configuration", {
    runtimeApiKeyPresent: Boolean(runtimeApiKey),
    environmentApiKeyPresent: Boolean(env && typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim()),
    runtimeModel: typeof process !== "undefined" ? process.env.OPENAI_ANALYSIS_MODEL || process.env.OPENAI_READER_MODEL || null : null,
    routingEnabled: Boolean((env && typeof env.OPENAI_MODEL_ROUTING === "string" && env.OPENAI_MODEL_ROUTING.trim()) || (typeof process !== "undefined" && process.env.OPENAI_MODEL_ROUTING?.trim())),
  });
  if (body.caseId) {
    const denied = await caseAccessResponse(env, body.caseId, auth.user);
    if (denied) return denied;
  }
  // Every uploaded account is an isolated test. Only the bundled,
  // de-identified rule corpus is used; this execution cannot teach a later
  // account anything about the current one.
  const corpusSnapshot = await getObservedCorpusSnapshot(env, "account");
  const analysis = analyzeClinicalAccount(body.lines, undefined, corpusSnapshot.corpus, {
    pamLines: body.pamLines as ChileanBillingLine[] | undefined,
    accountTotal: body.printedTotal,
    pamTotal: body.pamPrintedTotal,
  });
  try {
    analysis.llmAssist = await requestAnalysisAssist(
      body.lines,
      analysis,
      body.readerAssessment,
      body.printedTotal,
      env,
      { apiKey: runtimeApiKey },
    );
  } catch (error) {
    const message = error instanceof ReaderAssistError
      ? error.message
      : "La segunda lectura LLM no pudo completarse.";
    analysis.llmAssist = {
      status: "unavailable",
      summary: message,
      episode: { type: "unknown", hasOperatingRoom: false, hasHospitalStay: false, hasEmergency: false, anchors: [] },
      lineHypotheses: [],
      warnings: ["La matriz determinista se conserva y la asistencia puede reintentarse sin volver a cargar la cuenta."],
    };
  }
  analysis.observedCorpus.pendingContributionCount = corpusSnapshot.pendingCount;
  analysis.observedCorpus.validatedContributionCount = corpusSnapshot.validatedCount;
  analysis.corpusLearning = {
    status: "rejected",
    message: "La cuenta se analizó de forma aislada y no se conserva como memoria de otra cuenta.",
  };
  if (body.caseId) {
    if (!env?.DB) {
      localSaveAnalysis(body.caseId, analysis);
      return Response.json(isDeveloperUser(auth.user) ? analysis : { patientResult: buildPatientResult(analysis) });
    }
    await ensureCaseSchema(env.DB);
    await env.DB.prepare(`INSERT INTO case_analyses (id, case_id, analysis_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(case_id) DO UPDATE SET analysis_json = excluded.analysis_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), body.caseId, JSON.stringify(analysis)).run();
    await env.DB.prepare(`UPDATE cases SET status = 'analysis_ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.caseId).run();
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), body.caseId, "Análisis completado", "La cuenta clínica quedó clasificada y trazable por línea.").run();
  }
  return Response.json(isDeveloperUser(auth.user) ? analysis : { patientResult: buildPatientResult(analysis) });
}
