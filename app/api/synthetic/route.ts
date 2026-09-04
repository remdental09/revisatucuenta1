import type { DocumentExtraction } from "../../../lib/extraction/types.ts";
import { CURRENT_READER_VERSION } from "../../../lib/extraction/types.ts";
import { analyzeClinicalAccount, type ChileanBillingLine } from "../../../lib/rules/chilean-account.ts";
import { developerAccessResponse } from "../../../lib/server/case-access.ts";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";
import { requireApiUser } from "../../../lib/server/auth.ts";
import {
  getCloudflareEnv,
  localCreateCase,
  localSaveAnalysis,
  localSaveDocument,
  localSaveExtraction,
} from "../../../lib/server/runtime-store.ts";
import { getObservedCorpusSnapshot } from "../../../lib/server/observed-corpus-store.ts";
import {
  DEFAULT_SYNTHETIC_ACCOUNT_COUNT,
  MAX_SYNTHETIC_ACCOUNT_COUNT,
  MIN_SYNTHETIC_ACCOUNT_COUNT,
  generateSyntheticAccountSuite,
  type SyntheticAccount,
} from "../../../lib/synthetic/synthetic-accounts.ts";

type SyntheticRequest = { count?: unknown; seed?: unknown };

function integer(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return DEFAULT_SYNTHETIC_ACCOUNT_COUNT;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function pageCount(lines: ChileanBillingLine[]) {
  return Math.max(1, ...lines.map((line) => line.page));
}

function total(lines: ChileanBillingLine[]) {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

function extractionFor(account: SyntheticAccount, documentId: string): DocumentExtraction {
  const lines = account.lines.map((line) => ({ ...line, documentId }));
  const pages = pageCount(lines);
  const amount = total(lines);
  const provider = account.provider;
  return {
    readerVersion: CURRENT_READER_VERSION,
    pageCount: pages,
    usedOcr: false,
    pageKinds: Array.from({ length: pages }, (_, index) => ({ page: index + 1, kind: "account" as const })),
    readerAssessment: {
      status: "ready",
      parserMode: "direct_pdf",
      confidence: 0.99,
      templateFingerprint: "synthetic-corpus-v1",
      unknownItems: [],
      numericIssues: [],
      lowConfidencePages: [],
      signals: [
        "Cuenta sintética generada para pruebas internas del motor.",
        "Las glosas, códigos, secciones, prestadores y rangos provienen del corpus desidentificado.",
      ],
      nextAction: "Revisar las asociaciones funcionales y comparar el resultado con la cuenta de referencia.",
      codeChangeNeeded: false,
      llmAssist: { status: "not_attempted", role: "assistive_only", contractVersion: "synthetic-v1" },
    },
    account: {
      type: "account",
      label: "Cuenta clínica sintética",
      pages: Array.from({ length: pages }, (_, index) => index + 1),
      fields: [
        { key: "patient", label: "Paciente", value: "[SIMULADA] Sin paciente real", page: 1, confidence: 1 },
        { key: "provider", label: "Prestador", value: provider, page: 1, confidence: 1 },
        { key: "account_number", label: "Número de cuenta", value: `SIM-${documentId.slice(0, 8).toUpperCase()}`, page: 1, confidence: 1 },
        { key: "total", label: "Total sintético", value: `$${Math.round(amount).toLocaleString("es-CL")}`, page: 1, confidence: 1 },
      ],
      lines,
    },
  };
}

function matchedLineCount(analysis: ReturnType<typeof analyzeClinicalAccount>) {
  return analysis.lineAssessments.filter((item) =>
    item.observedEquivalents.length > 0
    || item.functionalEquivalenceAlerts.length > 0
    || item.candidates.length > 0,
  ).length;
}

function responseAccount(account: SyntheticAccount, caseId: string, analysis: ReturnType<typeof analyzeClinicalAccount>) {
  return {
    caseId,
    profileId: account.profileId,
    label: account.label,
    episodeLabel: account.episodeLabel,
    provider: account.provider,
    lineCount: account.lines.length,
    patternCount: account.patternKeys.length,
    total: total(account.lines),
    functionalAlertCount: analysis.functionalEquivalenceAlerts.length,
    matchedLineCount: matchedLineCount(analysis),
  };
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const denied = developerAccessResponse(auth.user);
  if (denied) return denied;

  let body: SyntheticRequest = {};
  try {
    body = (await request.json()) as SyntheticRequest;
  } catch {
    // An empty body is valid and uses the default suite size.
  }

  const count = integer(body.count);
  if (count < MIN_SYNTHETIC_ACCOUNT_COUNT || count > MAX_SYNTHETIC_ACCOUNT_COUNT) {
    return Response.json(
      { error: `La batería debe tener entre ${MIN_SYNTHETIC_ACCOUNT_COUNT} y ${MAX_SYNTHETIC_ACCOUNT_COUNT} cuentas.` },
      { status: 422 },
    );
  }

  const env = await getCloudflareEnv();
  const corpusSnapshot = await getObservedCorpusSnapshot(env, "account");
  const seed = text(body.seed) || `revisatucuenta-${crypto.randomUUID()}`;
  const suite = generateSyntheticAccountSuite({ corpus: corpusSnapshot.corpus, count, seed });
  const suiteId = crypto.randomUUID();
  const records = suite.accounts.map((account, index) => {
    const caseId = `synthetic-${suiteId}-${String(index + 1).padStart(2, "0")}`;
    const documentId = `${caseId}-account`;
    const extraction = extractionFor(account, documentId);
    const lines = (extraction.account?.lines ?? []) as ChileanBillingLine[];
    const analysis = analyzeClinicalAccount(lines, undefined, corpusSnapshot.corpus);
    analysis.observedCorpus.pendingContributionCount = corpusSnapshot.pendingCount;
    analysis.observedCorpus.validatedContributionCount = corpusSnapshot.validatedCount;
    analysis.corpusLearning = {
      status: "not_registered",
      message: "Cuenta sintética: no se incorpora al corpus activo ni a las observaciones pendientes.",
    };
    return { account, caseId, documentId, extraction, analysis };
  });

  if (!env?.DB) {
    for (const record of records) {
      const created = localCreateCase({
        id: record.caseId,
        ownerUserId: auth.user.id,
        ownerEmail: auth.user.email,
        patientName: `[SIMULADA] ${record.account.label}`,
        patientRun: "",
        contactEmail: "",
        episodeLabel: record.account.episodeLabel,
      });
      if (!created) return Response.json({ error: "No se pudo crear la cuenta sintética" }, { status: 409 });
      const bytes = new TextEncoder().encode(JSON.stringify(record.extraction)).length;
      localSaveDocument({
        id: record.documentId,
        caseId: record.caseId,
        name: `${record.caseId}.synthetic.json`,
        mimeType: "application/json",
        byteSize: bytes,
        classification: "Cuenta clínica sintética",
        confidence: 99,
      });
      localSaveExtraction(record.documentId, record.extraction, record.extraction.account?.fields.length || 0);
      localSaveAnalysis(record.caseId, record.analysis);
    }
  } else {
    await ensureCaseSchema(env.DB);
    const statements = records.flatMap((record) => {
      const bytes = new TextEncoder().encode(JSON.stringify(record.extraction)).length;
      return [
        env.DB.prepare(
          `INSERT INTO cases (id, owner_user_id, owner_email, patient_name, patient_run, contact_email, episode_label, status, updated_at) VALUES (?, ?, ?, ?, '', '', ?, 'analysis_ready', CURRENT_TIMESTAMP)`,
        ).bind(record.caseId, auth.user.id, auth.user.email, `[SIMULADA] ${record.account.label}`, record.account.episodeLabel),
        env.DB.prepare(
          `INSERT INTO documents (id, case_id, original_name, storage_key, mime_type, byte_size, classification, classification_confidence, processing_status, source_expires_at, source_deleted_at, page_from, page_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, ?)`,
        ).bind(record.documentId, record.caseId, `${record.caseId}.synthetic.json`, `synthetic/${record.caseId}/${record.documentId}.json`, "application/json", bytes, "Cuenta clínica sintética", 99, pageCount(record.extraction.account?.lines as ChileanBillingLine[] || [])),
        env.DB.prepare(
          `INSERT INTO document_extractions (id, document_id, extraction_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        ).bind(crypto.randomUUID(), record.documentId, JSON.stringify(record.extraction)),
        env.DB.prepare(
          `INSERT INTO case_analyses (id, case_id, analysis_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        ).bind(crypto.randomUUID(), record.caseId, JSON.stringify(record.analysis)),
        env.DB.prepare(
          `INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), record.caseId, "Cuenta sintética generada", "Batería de prueba creada desde el corpus desidentificado; no contiene identidad de paciente.",
          crypto.randomUUID(), record.caseId, "Análisis completado", "La cuenta sintética quedó analizada y trazable por línea.",
        ),
      ];
    });
    await env.DB.batch(statements);
  }

  return Response.json({
    suiteId,
    seed,
    accounts: records.map((record) => responseAccount(record.account, record.caseId, record.analysis)),
    sourceCorpus: {
      caseCount: corpusSnapshot.corpus.caseCount,
      observationCount: corpusSnapshot.corpus.observationCount,
      patternCount: corpusSnapshot.corpus.patternCount,
    },
    generated: {
      accountCount: records.length,
      observationCount: suite.generatedObservationCount,
      patternCount: suite.generatedPatternCount,
      totalLines: suite.generatedLineCount,
      fragmentationScenarioCount: suite.fragmentationScenarioCount,
    },
    message: "Batería sintética creada sólo para desarrolladores. No se incorporó al corpus y no contiene nombres, RUN ni correos de pacientes.",
    firstCaseId: records[0]?.caseId,
  }, { status: 201, headers: { "cache-control": "no-store" } });
}
