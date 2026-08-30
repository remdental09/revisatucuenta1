import type { ReaderAssessment } from "../extraction/types.ts";
import type {
  BundleFamily,
  ChileanBillingLine,
  ClinicalAccountAnalysis,
  LlmClinicalAnalysisAssist,
  LlmClinicalLineHypothesis,
} from "../rules/chilean-account.ts";
import {
  ReaderAssistError,
  readerAssistModel,
  resolveReaderAssistApiKey,
} from "./openai-reader-assist.ts";

type RuntimeEnvironment = Record<string, unknown> | null | undefined;

const MAX_LINES = 800;
const MAX_TEXT = 520;
const REQUEST_TIMEOUT_MS = 120_000;
const ALLOWED_BUNDLES = new Set<BundleFamily>([
  "operating_room",
  "hospital_stay",
  "hospitalized_medication",
  "procedure",
  "professional_fees",
  "unassigned",
]);

const analysisAssistSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "episode", "lineHypotheses", "warnings"],
  properties: {
    status: { type: "string", enum: ["ready_for_review", "insufficient_evidence"] },
    summary: { type: "string" },
    episode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "hasOperatingRoom", "hasHospitalStay", "hasEmergency", "anchors"],
      properties: {
        type: { type: "string", enum: ["surgical", "hospitalization", "emergency", "ambulatory", "mixed", "unknown"] },
        hasOperatingRoom: { type: "boolean" },
        hasHospitalStay: { type: "boolean" },
        hasEmergency: { type: "boolean" },
        anchors: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["lineId", "page", "evidence"],
            properties: {
              lineId: { type: "string" },
              page: { type: "integer" },
              evidence: { type: "string" },
            },
          },
        },
      },
    },
    lineHypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lineId", "page", "bundle", "decision", "confidence", "rationale", "evidence", "missingEvidence"],
        properties: {
          lineId: { type: "string" },
          page: { type: "integer" },
          bundle: { type: "string", enum: [...ALLOWED_BUNDLES] },
          decision: { type: "string", enum: ["review", "do_not_add", "insufficient_evidence"] },
          confidence: { type: "number" },
          rationale: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          missingEvidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM_INSTRUCTIONS = [
  "Eres un segundo analista técnico de cuentas clínicas chilenas.",
  "Tu función es reconocer el tipo de episodio y proponer hipótesis presuntivas de pertenencia de cada cargo a una prestación principal.",
  "No decides cobertura, ilegalidad, devolución ni reemplazas a la Superintendencia de Salud.",
  "Usa exclusivamente las líneas entregadas y conserva sus lineId y páginas.",
  "Distingue siempre la prestación principal y los honorarios: una cirugía, un Derecho de Pabellón, un Día Cama o un honorario no deben sumarse como fragmentación de sí mismos.",
  "Con pabellón confirmado, revisa como posibles componentes los insumos, implementos, útiles fungibles, gases, anestésicos, monitorización, campo estéril, acceso, aspiración, suturas y consumibles perioperatorios cobrados separadamente.",
  "En Urgencia no arrastres automáticamente materiales a pabellón; clasifica según sección, fecha, función y anclas del episodio.",
  "Para Día Cama considera enfermería general, administración de fleboclisis, inyecciones, sondas, toma de muestras y materiales generales, siempre como presunción a verificar.",
  "Si la lectura o el contexto no bastan, usa insufficient_evidence. No inventes filas, montos, glosas ni páginas.",
  "Devuelve únicamente el objeto JSON solicitado.",
].join(" ");

function runtimeValue(name: string) {
  if (typeof process === "undefined") return undefined;
  return process.env[name]?.trim() || undefined;
}

function environmentValue(env: RuntimeEnvironment, name: string) {
  const value = env && typeof env[name] === "string" ? env[name] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function analysisAssistModel(env?: RuntimeEnvironment) {
  return runtimeValue("OPENAI_ANALYSIS_MODEL")
    || environmentValue(env, "OPENAI_ANALYSIS_MODEL")
    || runtimeValue("OPENAI_VISION_MODEL")
    || environmentValue(env, "OPENAI_VISION_MODEL")
    || readerAssistModel(env);
}

export function isAnalysisAssistConfigured(env?: RuntimeEnvironment) {
  return Boolean(resolveReaderAssistApiKey(env));
}

function cap(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim();
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "output_text" && typeof value.text === "string" ? [value.text] : [];
    });
  }).join("\n").trim();
}

function boundedConfidence(value: unknown) {
  return Math.max(0, Math.min(1, typeof value === "number" && Number.isFinite(value) ? value : 0));
}

function stringList(value: unknown, max = 12) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => cap(item, 360)).filter(Boolean).slice(0, max)
    : [];
}

function selectedLines(lines: ChileanBillingLine[]) {
  if (lines.length <= MAX_LINES) return lines;
  const prioritized = [...lines].sort((left, right) => {
    const anchor = /pabell|quir|cirug|ectomia|anest|hospital|dia cama|urgencia|fleboclisis|sutura|trocar/i;
    const leftPriority = anchor.test(`${left.section ?? ""} ${left.description}`) ? 1 : 0;
    const rightPriority = anchor.test(`${right.section ?? ""} ${right.description}`) ? 1 : 0;
    return rightPriority - leftPriority || right.amount - left.amount || left.page - right.page;
  });
  return prioritized.slice(0, MAX_LINES);
}

function buildContext(
  lines: ChileanBillingLine[],
  analysis: ClinicalAccountAnalysis,
  readerAssessment?: ReaderAssessment,
  printedTotal?: number,
) {
  const deterministic = new Map(analysis.lineAssessments.map((item) => [item.line.id, item]));
  const chosen = selectedLines(lines);
  return {
    document: {
      printedTotal: typeof printedTotal === "number" && Number.isFinite(printedTotal) ? printedTotal : null,
      extractedLineCount: lines.length,
      submittedLineCount: chosen.length,
      reader: readerAssessment ? {
        status: readerAssessment.status,
        confidence: readerAssessment.confidence,
        parserMode: readerAssessment.parserMode,
        lowConfidencePages: readerAssessment.lowConfidencePages,
        signals: readerAssessment.signals,
      } : null,
    },
    framework: {
      operatingRoom: analysis.operatingRoomFramework,
      limitations: analysis.limitations,
    },
    lines: chosen.map((line) => {
      const item = deterministic.get(line.id);
      return {
        lineId: line.id,
        page: line.page,
        code: line.code ?? null,
        description: cap(line.description, 260),
        section: cap(line.section, 160) || null,
        subgroup: cap(line.subgroup, 160) || null,
        date: line.date ?? null,
        quantity: line.quantity ?? null,
        unitAmount: line.unitAmount ?? null,
        amount: line.amount,
        sourceText: cap(line.sourceText),
        readConfidence: line.confidence ?? null,
        deterministicCandidates: (item?.candidates ?? []).map((candidate) => ({
          bundle: candidate.bundle,
          probability: candidate.probability,
          reasons: candidate.reasons.slice(0, 3),
        })),
        functionalAlerts: (item?.functionalEquivalenceAlerts ?? []).slice(0, 4).map((alert) => ({
          family: alert.familyLabel,
          targets: alert.targetBundles,
          comparability: alert.comparability,
        })),
      };
    }),
  };
}

export function parseAnalysisAssistResponse(payload: unknown, validLines: ChileanBillingLine[], model?: string): LlmClinicalAnalysisAssist {
  const text = responseOutputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid");
    raw = parsed as Record<string, unknown>;
  } catch {
    throw new ReaderAssistError("LLM_INVALID_RESPONSE", "El análisis LLM devolvió una respuesta que no pudo validarse.", 502);
  }
  const validById = new Map(validLines.map((line) => [line.id, line]));
  const episodeRaw = raw.episode && typeof raw.episode === "object" ? raw.episode as Record<string, unknown> : {};
  const episodeTypes = new Set(["surgical", "hospitalization", "emergency", "ambulatory", "mixed", "unknown"]);
  const hypothesesRaw = Array.isArray(raw.lineHypotheses) ? raw.lineHypotheses : [];
  const seen = new Set<string>();
  const lineHypotheses: LlmClinicalLineHypothesis[] = [];
  for (const item of hypothesesRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const lineId = cap(row.lineId, 180);
    const source = validById.get(lineId);
    const bundle = typeof row.bundle === "string" && ALLOWED_BUNDLES.has(row.bundle as BundleFamily)
      ? row.bundle as BundleFamily
      : "unassigned";
    const decision = row.decision === "review" || row.decision === "do_not_add" || row.decision === "insufficient_evidence"
      ? row.decision
      : "insufficient_evidence";
    const key = `${lineId}|${bundle}|${decision}`;
    if (!source || seen.has(key)) continue;
    seen.add(key);
    lineHypotheses.push({
      lineId,
      page: source.page,
      bundle,
      decision,
      confidence: boundedConfidence(row.confidence),
      rationale: cap(row.rationale, 900),
      evidence: stringList(row.evidence),
      missingEvidence: stringList(row.missingEvidence),
    });
  }
  const anchorsRaw = Array.isArray(episodeRaw.anchors) ? episodeRaw.anchors : [];
  const anchors = anchorsRaw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const lineId = cap(row.lineId, 180);
    const source = validById.get(lineId);
    return source ? [{ lineId, page: source.page, evidence: cap(row.evidence, 600) }] : [];
  }).slice(0, 30);
  const status = raw.status === "ready_for_review" ? "ready_for_review" : "insufficient_evidence";
  return {
    status,
    model,
    summary: cap(raw.summary, 1800),
    episode: {
      type: typeof episodeRaw.type === "string" && episodeTypes.has(episodeRaw.type) ? episodeRaw.type as LlmClinicalAnalysisAssist["episode"]["type"] : "unknown",
      hasOperatingRoom: episodeRaw.hasOperatingRoom === true,
      hasHospitalStay: episodeRaw.hasHospitalStay === true,
      hasEmergency: episodeRaw.hasEmergency === true,
      anchors,
    },
    lineHypotheses,
    warnings: stringList(raw.warnings, 20),
  };
}

export async function requestAnalysisAssist(
  lines: ChileanBillingLine[],
  analysis: ClinicalAccountAnalysis,
  readerAssessment?: ReaderAssessment,
  printedTotal?: number,
  env?: RuntimeEnvironment,
  options: { fetchImpl?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<LlmClinicalAnalysisAssist> {
  const model = options.model?.trim() || analysisAssistModel(env);
  const apiKey = resolveReaderAssistApiKey(env, options.apiKey);
  if (!apiKey) {
    return {
      status: "not_configured",
      model,
      summary: "La matriz determinista quedó disponible, pero la segunda lectura LLM no está configurada en este entorno.",
      episode: { type: "unknown", hasOperatingRoom: false, hasHospitalStay: false, hasEmergency: false, anchors: [] },
      lineHypotheses: [],
      warnings: ["Configura OPENAI_API_KEY para activar la segunda lectura semántica."],
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_INSTRUCTIONS }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(buildContext(lines, analysis, readerAssessment, printedTotal)) }] },
        ],
        text: { format: { type: "json_schema", name: "clinical_account_analysis_assist", strict: true, schema: analysisAssistSchema } },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ReaderAssistError("LLM_AUTHENTICATION_FAILED", "La clave del análisis LLM no fue aceptada.", 502);
      if (response.status === 429) throw new ReaderAssistError("LLM_RATE_LIMITED", "El análisis LLM alcanzó temporalmente el límite del proveedor.", 429);
      if (response.status >= 500) throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "El proveedor del análisis LLM no está disponible.", 502);
      throw new ReaderAssistError("LLM_PROVIDER_ERROR", "El proveedor rechazó el análisis LLM.", 502);
    }
    return parseAnalysisAssistResponse(await response.json(), lines, model);
  } catch (error) {
    if (error instanceof ReaderAssistError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "El análisis LLM excedió el tiempo disponible.", 504);
    }
    throw new ReaderAssistError("LLM_PROVIDER_ERROR", "No se pudo completar el análisis LLM.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
