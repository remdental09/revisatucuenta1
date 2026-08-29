import type {
  DocumentExtraction,
  ReaderAssistResponse,
  ReaderAssistResult,
  ReaderAssessment,
} from "../extraction/types.ts";
import { assessExtractionQuality } from "../extraction/reader-quality.ts";

type ReaderKind = "account" | "pam";
type ExtractedLines = NonNullable<DocumentExtraction[ReaderKind]>["lines"];
type RuntimeEnvironment = Record<string, unknown> | null | undefined;

export type ReaderAssistContext = {
  documentType: ReaderKind;
  readerAssessment: Pick<ReaderAssessment, "status" | "parserMode" | "confidence" | "templateFingerprint" | "unknownItems" | "numericIssues" | "lowConfidencePages" | "signals" | "codeChangeNeeded">;
  fields: Array<{ key: string; label: string; value: string; page: number; confidence: number; sourceText?: string }>;
  lines: Array<{
    index: number;
    page: number;
    description: string;
    code: string | null;
    section: string | null;
    quantity: number | null;
    unitAmount: number | null;
    amount: number;
    confidence: number | null;
    sourceText: string | null;
  }>;
};

export type ReaderAssistFailureCode =
  | "LLM_NOT_CONFIGURED"
  | "LLM_AUTHENTICATION_FAILED"
  | "LLM_RATE_LIMITED"
  | "LLM_PROVIDER_UNAVAILABLE"
  | "LLM_PROVIDER_ERROR"
  | "LLM_INVALID_RESPONSE";

export class ReaderAssistError extends Error {
  code: ReaderAssistFailureCode;
  status: number;

  constructor(code: ReaderAssistFailureCode, message: string, status: number) {
    super(message);
    this.name = "ReaderAssistError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_LINES = 240;
const MAX_FIELDS = 30;
const MAX_TEXT = 320;
const REQUEST_TIMEOUT_MS = 45_000;

function runtimeValue(name: string) {
  if (typeof process === "undefined") return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

function environmentValue(env: RuntimeEnvironment, name: string) {
  const value = env && typeof env[name] === "string" ? env[name] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveApiKey(env: RuntimeEnvironment, explicit?: string) {
  return explicit?.trim() || runtimeValue("OPENAI_API_KEY") || environmentValue(env, "OPENAI_API_KEY");
}

export function readerAssistModel(env?: RuntimeEnvironment) {
  return runtimeValue("OPENAI_READER_MODEL") || environmentValue(env, "OPENAI_READER_MODEL") || DEFAULT_MODEL;
}

export function isReaderAssistConfigured(env?: RuntimeEnvironment) {
  return Boolean(resolveApiKey(env));
}

function capText(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function redactText(value: unknown) {
  return capText(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[correo omitido]")
    .replace(/\b\d{1,2}(?:\.\d{3}){2}[-\s]?[0-9kK]\b/g, "[RUT omitido]");
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldIsIdentity(key: string, label: string) {
  return /patient|paciente|rut|correo|email|tel[eé]fono|phone|titular|nombre/i.test(`${key} ${label}`);
}

function prioritizedLineIndexes(lines: ExtractedLines, assessment: ReaderAssessment) {
  const flaggedPages = new Set(assessment.lowConfidencePages);
  const flagged = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => flaggedPages.has(line.page) || (line.confidence !== undefined && line.confidence < 80));
  const flaggedIndexes = new Set(flagged.map(({ index }) => index));
  const orderedIndexes = [...flagged.map(({ index }) => index), ...lines.map((_, index) => index).filter((index) => !flaggedIndexes.has(index))];
  return orderedIndexes.slice(0, MAX_LINES);
}

/**
 * Builds the smallest useful evidence package for the secondary reader.
 * The original PDF is deliberately not sent to OpenAI in this first fallback:
 * the model receives structured rows and page evidence already produced by the
 * browser reader, and a human remains responsible for accepting corrections.
 */
export function buildReaderAssistContext(extraction: DocumentExtraction, expectedKind: ReaderKind): ReaderAssistContext {
  const source = extraction[expectedKind];
  const assessment = extraction.readerAssessment ?? assessExtractionQuality(extraction, expectedKind);
  const sourceLines = source?.lines ?? [];
  const selectedIndexes = prioritizedLineIndexes(sourceLines, assessment);
  const fields = (source?.fields ?? []).slice(0, MAX_FIELDS).map((field) => ({
    key: field.key,
    label: capText(field.label, 100),
    value: fieldIsIdentity(field.key, field.label) ? "[dato personal omitido]" : redactText(field.value),
    page: field.page,
    confidence: field.confidence,
    sourceText: fieldIsIdentity(field.key, field.label) ? undefined : redactText(field.sourceText),
  }));
  const lines = selectedIndexes.map((index) => {
    const line = sourceLines[index];
    return {
      index: index + 1,
      page: line.page,
      description: redactText(line.description),
      code: line.code ? capText(line.code, 80) : null,
      section: line.section ? capText(line.section, 100) : null,
      quantity: numberOrNull(line.quantity),
      unitAmount: numberOrNull(line.unitAmount),
      amount: line.amount,
      confidence: numberOrNull(line.confidence),
      sourceText: line.sourceText ? redactText(line.sourceText) : null,
    };
  });
  return {
    documentType: expectedKind,
    readerAssessment: {
      status: assessment.status,
      parserMode: assessment.parserMode,
      confidence: assessment.confidence,
      templateFingerprint: assessment.templateFingerprint,
      unknownItems: assessment.unknownItems.slice(0, 30),
      numericIssues: assessment.numericIssues.slice(0, 30),
      lowConfidencePages: assessment.lowConfidencePages.slice(0, 50),
      signals: assessment.signals.slice(0, 30),
      codeChangeNeeded: assessment.codeChangeNeeded,
    },
    fields,
    lines,
  };
}

const readerAssistSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "fields", "lineCorrections", "unknownItems", "safetyNotes"],
  properties: {
    status: { type: "string", enum: ["assisted", "insufficient_evidence"] },
    summary: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "value", "page", "evidence", "confidence"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          page: { type: "integer" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    lineCorrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "page", "description", "code", "quantity", "unitAmount", "amount", "evidence", "confidence", "reason"],
        properties: {
          index: { type: "integer" },
          page: { type: "integer" },
          description: { type: "string" },
          code: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unitAmount: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          evidence: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    unknownItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "page", "evidence", "reason", "confidence"],
        properties: {
          value: { type: "string" },
          page: { type: "integer" },
          evidence: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    safetyNotes: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM_INSTRUCTIONS = [
  "Eres un lector secundario de cuentas clínicas chilenas.",
  "Tu tarea es asistir la lectura, no resolver cobertura, derecho de pabellón, Día Cama, devoluciones ni conclusiones legales.",
  "El lector determinista sigue siendo la fuente base. Sólo propone una corrección cuando exista respaldo en la evidencia de página entregada.",
  "No inventes glosas, códigos, cantidades, unitarios, totales, campos ni páginas. Si la evidencia no alcanza, usa insufficient_evidence.",
  "El índice de línea es 1-based y corresponde al paquete recibido.",
  "Las correcciones son propuestas para revisión humana. No cambies código, corpus, matriz ni resultado del caso.",
  "Devuelve únicamente el objeto JSON solicitado.",
].join(" ");

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

function boundedPage(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function nullableNumber(value: unknown) {
  return value === null ? null : numberOrNull(value);
}

export function parseReaderAssistResponse(payload: unknown): ReaderAssistResult {
  const text = responseOutputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReaderAssistError("LLM_INVALID_RESPONSE", "La asistencia LLM devolvió una respuesta que no pudo validarse.", 502);
  }
  if (!value || typeof value !== "object") {
    throw new ReaderAssistError("LLM_INVALID_RESPONSE", "La asistencia LLM no devolvió un resultado estructurado.", 502);
  }
  const raw = value as Record<string, unknown>;
  if (raw.status !== "assisted" && raw.status !== "insufficient_evidence") {
    throw new ReaderAssistError("LLM_INVALID_RESPONSE", "La asistencia LLM devolvió un estado no reconocido.", 502);
  }
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  const corrections = Array.isArray(raw.lineCorrections) ? raw.lineCorrections : [];
  const unknownItems = Array.isArray(raw.unknownItems) ? raw.unknownItems : [];
  const safetyNotes = Array.isArray(raw.safetyNotes) ? raw.safetyNotes.filter((item): item is string => typeof item === "string").map((item) => capText(item, 240)).slice(0, 20) : [];
  return {
    status: raw.status,
    summary: capText(raw.summary, 1200),
    fields: fields.slice(0, MAX_FIELDS).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        key: capText(row.key, 100),
        label: capText(row.label, 160),
        value: capText(row.value, 240),
        page: boundedPage(row.page),
        evidence: capText(row.evidence, MAX_TEXT),
        confidence: boundedConfidence(row.confidence),
      };
    }),
    lineCorrections: corrections.slice(0, MAX_LINES).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        index: boundedPage(row.index),
        page: boundedPage(row.page),
        description: capText(row.description, 240),
        code: row.code === null ? null : capText(row.code, 100),
        quantity: nullableNumber(row.quantity),
        unitAmount: nullableNumber(row.unitAmount),
        amount: nullableNumber(row.amount),
        evidence: capText(row.evidence, MAX_TEXT),
        confidence: boundedConfidence(row.confidence),
        reason: capText(row.reason, 500),
      };
    }),
    unknownItems: unknownItems.slice(0, 30).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        value: capText(row.value, 180),
        page: boundedPage(row.page),
        evidence: capText(row.evidence, MAX_TEXT),
        reason: capText(row.reason, 500),
        confidence: boundedConfidence(row.confidence),
      };
    }),
    safetyNotes,
  };
}

export async function requestReaderAssist(
  context: ReaderAssistContext,
  env?: RuntimeEnvironment,
  options: { fetchImpl?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<ReaderAssistResponse> {
  const model = options.model?.trim() || readerAssistModel(env);
  if (!context.lines.length) {
    return {
      status: "insufficient_evidence",
      model,
      result: {
        status: "insufficient_evidence",
        summary: "No existen líneas estructuradas que el asistente pueda contrastar. Se necesita revisión humana del documento original o una etapa de OCR que produzca evidencia por página.",
        fields: [],
        lineCorrections: [],
        unknownItems: [],
        safetyNotes: ["El LLM no recibió el PDF original y no puede reconstruir una cuenta sin evidencia extraída."],
      },
      warnings: ["La cuenta requiere revisión humana u OCR adicional antes de solicitar una corrección asistida."],
    };
  }
  const apiKey = resolveApiKey(env, options.apiKey);
  if (!apiKey) throw new ReaderAssistError("LLM_NOT_CONFIGURED", "La asistencia LLM no está configurada en este entorno.", 503);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_INSTRUCTIONS }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(context) }] },
        ],
        text: { format: { type: "json_schema", name: "reader_assist_result", strict: true, schema: readerAssistSchema } },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ReaderAssistError("LLM_AUTHENTICATION_FAILED", "La clave de asistencia LLM no fue aceptada por el proveedor.", 502);
      if (response.status === 429) throw new ReaderAssistError("LLM_RATE_LIMITED", "La asistencia LLM alcanzó temporalmente el límite del proveedor.", 429);
      if (response.status >= 500) throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "El proveedor de asistencia LLM no está disponible en este momento.", 502);
      throw new ReaderAssistError("LLM_PROVIDER_ERROR", "El proveedor rechazó la solicitud de asistencia LLM.", 502);
    }
    const payload = await response.json();
    const result = parseReaderAssistResponse(payload);
    return {
      status: result.status === "assisted" ? "ready_for_review" : "insufficient_evidence",
      model,
      result,
      warnings: [
        "La respuesta es una propuesta de lectura auxiliar; no modifica la matriz, el código ni el corpus.",
        "Cada corrección debe verificarse contra el documento original antes de aceptarse.",
      ],
    };
  } catch (error) {
    if (error instanceof ReaderAssistError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "La asistencia LLM tardó demasiado y quedó pendiente de revisión humana.", 504);
    }
    throw new ReaderAssistError("LLM_PROVIDER_ERROR", "No se pudo completar la asistencia LLM.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
