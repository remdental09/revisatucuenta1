import type {
  ReaderAssistResult,
  VisionAssistResponse,
  VisionPageImage,
} from "../extraction/types.ts";
import {
  ReaderAssistError,
  type ReaderAssistContext,
  parseReaderAssistResponse,
  readerAssistModel,
  readerAssistSchema,
  resolveReaderAssistApiKey,
} from "./openai-reader-assist.ts";

type RuntimeEnvironment = Record<string, unknown> | null | undefined;

const DEFAULT_VISION_MODEL = "gpt-5.4-mini";
const MAX_VISION_PAGES = 4;
const MAX_VISION_IMAGES = MAX_VISION_PAGES * 16;
const MAX_IMAGE_DATA_URL_LENGTH = 9_000_000;
const MAX_VISION_PAYLOAD_LENGTH = 48_000_000;
const REQUEST_TIMEOUT_MS = 90_000;

const VISION_INSTRUCTIONS = [
  "Eres un segundo lector visual de cuentas clínicas chilenas.",
  "Lee únicamente la información visible en las imágenes de las páginas entregadas y contrástala con la evidencia estructurada adjunta.",
  "Tu función es corregir posibles errores de lectura: glosas, códigos, fechas, cantidades, valores unitarios, totales y campos identificatorios visibles. Si no hay líneas estructuradas, puedes proponer renglones visibles desde la imagen, siempre como lectura auxiliar y no como resultado definitivo.",
  "No decidas cobertura, Día Cama, derecho de pabellón, devoluciones, fragmentación ni conclusiones legales.",
  "No inventes información. Si una cifra, glosa o campo no se ve con claridad, déjalo como desconocido y explica qué debe verificarse.",
  "Devuelve únicamente el objeto JSON solicitado. Toda corrección es una propuesta para revisión humana y no modifica la matriz ni el código.",
].join(" ");

function runtimeValue(name: string) {
  if (typeof process === "undefined") return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

function environmentValue(env: RuntimeEnvironment, name: string) {
  const value = env && typeof env[name] === "string" ? env[name] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function visionAssistModel(env?: RuntimeEnvironment) {
  return runtimeValue("OPENAI_VISION_MODEL") || environmentValue(env, "OPENAI_VISION_MODEL") || readerAssistModel(env) || DEFAULT_VISION_MODEL;
}

export function isVisionPageImage(value: unknown): value is VisionPageImage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  const zone = page.zone;
  const validZone = page.region !== "zone" || (
    Boolean(zone) && typeof zone === "object" &&
    typeof (zone as Record<string, unknown>).row === "number" && Number.isInteger((zone as Record<string, unknown>).row) && (zone as Record<string, unknown>).row > 0 &&
    typeof (zone as Record<string, unknown>).column === "number" && Number.isInteger((zone as Record<string, unknown>).column) && (zone as Record<string, unknown>).column > 0 &&
    typeof (zone as Record<string, unknown>).rows === "number" && Number.isInteger((zone as Record<string, unknown>).rows) && [3, 4].includes((zone as Record<string, unknown>).rows as number) &&
    typeof (zone as Record<string, unknown>).columns === "number" && Number.isInteger((zone as Record<string, unknown>).columns) && [3, 4].includes((zone as Record<string, unknown>).columns as number) &&
    (zone as Record<string, unknown>).row as number <= (zone as Record<string, unknown>).rows as number &&
    (zone as Record<string, unknown>).column as number <= (zone as Record<string, unknown>).columns as number
  );
  return typeof page.page === "number" && Number.isInteger(page.page) && page.page > 0
    && (page.region === "full_page" || page.region === "line_crop" || page.region === "zone")
    && validZone
    && typeof page.dataUrl === "string"
    && page.dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH
    && /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(page.dataUrl);
}

function insufficientResult(summary: string, warning: string): VisionAssistResponse {
  const result: ReaderAssistResult = {
    status: "insufficient_evidence",
    summary,
    fields: [],
    lineCorrections: [],
    unknownItems: [],
    safetyNotes: [warning],
  };
  return {
    mode: "vision",
    status: "insufficient_evidence",
    model: DEFAULT_VISION_MODEL,
    reviewedPages: [],
    result,
    warnings: [warning],
  };
}

export async function requestVisionAssist(
  context: ReaderAssistContext,
  images: VisionPageImage[],
  env?: RuntimeEnvironment,
  options: { fetchImpl?: typeof fetch; apiKey?: string; model?: string } = {},
): Promise<VisionAssistResponse> {
  const model = options.model?.trim() || visionAssistModel(env);
  const pages = images
    .filter(isVisionPageImage)
    .filter((image, index, all) => all.findIndex((candidate) => candidate.page === image.page && candidate.region === image.region && JSON.stringify(candidate.zone || null) === JSON.stringify(image.zone || null)) === index)
    .slice(0, MAX_VISION_IMAGES);
  const reviewedPages = [...new Set(pages.map((image) => image.page))].slice(0, MAX_VISION_PAGES);
  const reviewedImageCount = pages.length;
  const gridSize = pages.find((image) => image.region === "zone")?.zone?.rows;
  if (!pages.length) {
    return { ...insufficientResult("No existen imágenes suficientes para una lectura visual auxiliar.", "La visión LLM necesita páginas legibles; el documento original debe conservarse para revisión humana."), model, reviewedPages, reviewedImageCount: 0 };
  }
  if (pages.reduce((total, image) => total + image.dataUrl.length, 0) > MAX_VISION_PAYLOAD_LENGTH) {
    throw new ReaderAssistError("LLM_PROVIDER_ERROR", "Las zonas preparadas superan el tamaño máximo de revisión visual; reduce la cantidad de páginas o zonas.", 413);
  }
  const apiKey = resolveReaderAssistApiKey(env, options.apiKey);
  if (!apiKey) throw new ReaderAssistError("LLM_NOT_CONFIGURED", "La visión LLM no está configurada en este entorno.", 503);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const content = [
    {
      type: "input_text",
      text: JSON.stringify({
        task: "Contrastar las páginas con la evidencia estructurada y proponer sólo correcciones visibles.",
        document: context,
        reviewedPages,
      }),
    },
    ...pages.flatMap((image) => [
      { type: "input_text", text: image.region === "zone" && image.zone
        ? `Página ${image.page}; zona ${image.zone.row}×${image.zone.column} de una cuadrícula ${image.zone.rows}×${image.zone.columns}.`
        : `Página ${image.page}; zona ${image.region}.` },
      { type: "input_image", image_url: image.dataUrl, detail: "high" },
    ]),
  ];
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: VISION_INSTRUCTIONS }] },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: "reader_assist_result", strict: true, schema: readerAssistSchema } },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ReaderAssistError("LLM_AUTHENTICATION_FAILED", "La clave de visión LLM no fue aceptada por el proveedor.", 502);
      if (response.status === 429) throw new ReaderAssistError("LLM_RATE_LIMITED", "La visión LLM alcanzó temporalmente el límite del proveedor.", 429);
      if (response.status >= 500) throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "El proveedor de visión LLM no está disponible en este momento.", 502);
      throw new ReaderAssistError("LLM_PROVIDER_ERROR", "El proveedor rechazó la solicitud de visión LLM.", 502);
    }
    const payload = await response.json();
    const result = parseReaderAssistResponse(payload);
    return {
      mode: "vision",
      status: result.status === "assisted" ? "ready_for_review" : "insufficient_evidence",
      model,
      reviewedPages,
      reviewedImageCount,
      ...(gridSize === 3 || gridSize === 4 ? { gridSize } : {}),
      result,
      warnings: [
        "La visión LLM recibió las páginas seleccionadas de la cuenta; la respuesta no se guarda como una conclusión automática.",
        "La propuesta debe verificarse contra el PDF original antes de aceptarse.",
        "La visión no decide cobertura, fragmentación ni devolución.",
      ],
    };
  } catch (error) {
    if (error instanceof ReaderAssistError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ReaderAssistError("LLM_PROVIDER_UNAVAILABLE", "La visión LLM tardó demasiado y quedó pendiente de revisión humana.", 504);
    }
    throw new ReaderAssistError("LLM_PROVIDER_ERROR", "No se pudo completar la lectura visual auxiliar.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
