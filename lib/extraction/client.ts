import { structureDocument, type TextPage } from "./parsers.ts";
import { installPromiseWithResolversPolyfill } from "./promise-compat.ts";
import { assessExtractionQuality } from "./reader-quality.ts";
import type { DocumentExtraction, OcrEnhancementDiagnostic } from "./types.ts";

const pdfWorkerUrl = "/pdf-worker-bootstrap.mjs";
// Keep the Spanish OCR model on the same origin so mobile deployments do not
// hang waiting for a third-party CDN during worker initialization.
const ocrLanguagePath = "/";
const ocrWorkerPath = "/tesseract-worker.min.js";
const ocrCorePath = "/tesseract-core-lstm.wasm.js";
const PDF_LOAD_TIMEOUT_MS = 45_000;
const OCR_INITIALIZATION_TIMEOUT_MS = 120_000;
const OCR_PAGE_TIMEOUT_MS = 300_000;

type ExpectedKind = "account" | "pam" | "mixed" | "unknown";

type PositionedTextItem = {
  str?: string;
  transform?: number[];
};

type OcrWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  recognize: (image: File | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let ocrWorkerPromise: Promise<OcrWorker> | undefined;
let ocrProgressListener: ((progress: number) => void) | undefined;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (reason) => { window.clearTimeout(timer); reject(reason); },
    );
  });
}

export function textItemsToLines(items: PositionedTextItem[]) {
  const rows: Array<{ y: number; cells: Array<{ x: number; text: string }> }> = [];
  for (const item of items) {
    const text = item.str?.trim();
    const transform = item.transform;
    if (!text || !transform || transform.length < 6) continue;
    const x = transform[4];
    const y = transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, text });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) =>
      row.cells
        .sort((left, right) => left.x - right.x)
        .map((cell) => cell.text)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Scores OCR candidates using signals useful for account tables. This is not
 * a language-model confidence and is intentionally exported for tests.
 */
export function scoreOcrText(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numericTokens = text.match(/\b\d[\d.,-]{1,}\b/g)?.length ?? 0;
  const clinicalAnchors = text.match(/cuenta|paciente|cl[ií]nica|hospital|d[ií]a cama|pabell[oó]n|insumo|medicamento|total|cantidad|c[oó]digo|fecha/gi)?.length ?? 0;
  const suspiciousTokens = text.match(/[�]|\b(?:[A-Z]\s){3,}[A-Z]\b/g)?.length ?? 0;
  return Math.round(
    Math.min(text.replace(/\s/g, "").length / 180, 12) +
    Math.min(lines.length, 24) * 0.6 +
    Math.min(numericTokens, 30) * 1.8 +
    Math.min(clinicalAnchors, 12) * 1.4 -
    Math.min(suspiciousTokens, 10) * 2.5,
  );
}

function needsEnhancedOcr(text: string) {
  const normalized = text.replace(/\s/g, "");
  const numericTokens = text.match(/\b\d[\d.,-]{1,}\b/g)?.length ?? 0;
  return normalized.length < 180 || numericTokens < 4 || /�|\[\)|\[\]|\b(?:total|cantidad|unitario)\b/i.test(text);
}

export function chooseOcrText(primary: string, enhanced: string, lineCrop: string) {
  const primaryScore = scoreOcrText(primary);
  const enhancedScore = scoreOcrText(enhanced);
  const lineCropScore = scoreOcrText(lineCrop);
  const candidates: Array<{ pass: "primary" | "enhanced" | "line_crop"; text: string; score: number }> = [
    { pass: "primary", text: primary, score: primaryScore },
    { pass: "enhanced", text: enhanced, score: enhancedScore },
  ];
  // A crop is used only when it has enough content and a clear advantage;
  // otherwise it could discard identity/header fields from the full page.
  if (lineCrop.replace(/\s/g, "").length >= 120 && lineCropScore >= Math.max(primaryScore, enhancedScore) + 8) {
    candidates.push({ pass: "line_crop", text: lineCrop, score: lineCropScore });
  }
  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  return { primaryScore, selected: selected.pass, selectedScore: selected.score, text: selected.text, candidates };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const { createWorker } = await import("tesseract.js");
    const workerPromise = createWorker("spa", 1, {
      workerPath: ocrWorkerPath,
      corePath: ocrCorePath,
      langPath: ocrLanguagePath,
      // Use a direct worker URL. Some deployed browsers load the worker
      // through the Blob wrapper but do not allow that wrapper to continue
      // with importScripts, leaving OCR permanently at its initialization
      // state without surfacing a page-level error.
      workerBlobURL: false,
      logger: (message) => {
        if (typeof message.progress === "number") ocrProgressListener?.(message.progress * 100);
      },
    }) as unknown as Promise<OcrWorker>;
    ocrWorkerPromise = workerPromise
      .then(async (worker) => {
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: "6",
        });
        return worker;
      })
      .catch((reason) => {
        ocrWorkerPromise = undefined;
        throw reason;
      });
  }
  return ocrWorkerPromise;
}

async function recognizeImage(image: File | HTMLCanvasElement, onProgress?: (progress: number) => void, pageSegmentationMode = "6") {
  const worker = await withTimeout(
    getOcrWorker(),
    OCR_INITIALIZATION_TIMEOUT_MS,
    "El lector OCR no respondió a tiempo. Conserva el original para revisión humana o LLM externa.",
  );
  ocrProgressListener = onProgress;
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: pageSegmentationMode,
    });
    const result = await withTimeout(
      worker.recognize(image),
      OCR_PAGE_TIMEOUT_MS,
      "El OCR no terminó esta página a tiempo. Conserva el original para revisión humana o LLM externa.",
    );
    return result.data.text;
  } finally {
    if (ocrProgressListener === onProgress) ocrProgressListener = undefined;
  }
}

function renderPageCanvas(page: { getViewport: (options: { scale: number }) => { width: number; height: number }; render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<unknown> } }, scale = 2.2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve<HTMLCanvasElement | undefined>(undefined);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return page.render({ canvas, canvasContext: context, viewport }).promise.then(() => canvas);
}

function enhanceCanvas(source: HTMLCanvasElement) {
  const scale = 1.45;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(source.width * scale);
  canvas.height = Math.ceil(source.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const grayscale = new Uint8Array(canvas.width * canvas.height);
  let sampledTotal = 0;
  let samples = 0;
  for (let index = 0; index < data.length; index += 16) {
    sampledTotal += Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    samples += 1;
  }
  const average = samples ? sampledTotal / samples : 180;
  const threshold = Math.max(135, Math.min(205, average * 0.78));
  for (let pixel = 0, index = 0; pixel < grayscale.length; pixel += 1, index += 4) {
    const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = Math.max(0, Math.min(255, (luminance - 128) * 1.38 + 128));
    const value = contrasted < threshold ? Math.max(0, contrasted * 0.68) : Math.min(255, contrasted + 8);
    grayscale[pixel] = value;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  // Remove isolated dark speckles while preserving connected character strokes.
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const pixel = y * canvas.width + x;
      if (grayscale[pixel] > 105) continue;
      let darkNeighbours = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          if (grayscale[(y + offsetY) * canvas.width + x + offsetX] < 105) darkNeighbours += 1;
        }
      }
      if (darkNeighbours === 0) {
        const index = pixel * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function cropLineRegion(source: HTMLCanvasElement) {
  const top = Math.floor(source.height * 0.12);
  const scale = 1.2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(source.width * scale);
  canvas.height = Math.ceil((source.height - top) * scale);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, top, source.width, source.height - top, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function extractPdf(file: File, expected: ExpectedKind, onProgress?: (progress: number) => void) {
  installPromiseWithResolversPolyfill();
  onProgress?.(3);
  // The default PDF.js build targets Safari 18+. Clinical accounts are also
  // uploaded from older iPhones and embedded mobile browsers, so always load
  // the official legacy distribution instead of failing first and asking the
  // user to upload the same private document again.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  onProgress?.(4);
  // PDF.js still validates workerSrc even when worker execution is disabled.
  // Keep the local URL configured for that validation while using the
  // compatible main-thread fallback below.
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  // Some mobile and embedded browsers load the PDF worker but never answer
  // its first message. Reading in the main thread is slower, but it gives
  // the pilot a deterministic fallback for scanned accounts and lets the
  // OCR progress continue instead of remaining at 2% indefinitely.
  const pdfOptions = { data: await file.arrayBuffer(), disableWorker: true };
  onProgress?.(5);
  const loadingTask = pdfjs.getDocument(pdfOptions);
  let pdf;
  try {
    pdf = await withTimeout(
      loadingTask.promise,
      PDF_LOAD_TIMEOUT_MS,
      "El lector PDF no respondió a tiempo. Vuelve a cargar la cuenta o conserva el original para revisión humana/LLM.",
    );
    onProgress?.(6);
  } catch (reason) {
    await loadingTask.destroy().catch(() => undefined);
    throw reason;
  }
  const pages: TextPage[] = [];
  const ocrPages: number[] = [];
  let usedOcr = false;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await withTimeout(
      pdf.getPage(pageNumber),
      PDF_LOAD_TIMEOUT_MS,
      `El lector PDF no respondió al abrir la página ${pageNumber}. Conserva el original para revisión humana/LLM.`,
    );
    const content = await withTimeout(
      page.getTextContent(),
      PDF_LOAD_TIMEOUT_MS,
      `El lector PDF no respondió al leer la página ${pageNumber}. Conserva el original para revisión humana/LLM.`,
    );
    let text = textItemsToLines(
      content.items.map((item) =>
        "str" in item ? { str: item.str, transform: item.transform } : {},
      ),
    );
    if (text.replace(/\s/g, "").length < 60) {
      usedOcr = true;
      ocrPages.push(pageNumber);
      // Account rows are dense and their totals often differ only by a
      // thousands separator. A larger render materially improves OCR of the
      // unit, tax and total columns without changing the extracted layout.
      const canvas = await withTimeout(
        renderPageCanvas(page),
        PDF_LOAD_TIMEOUT_MS,
        `El lector PDF no pudo renderizar la página ${pageNumber} para OCR. Conserva el original para revisión humana/LLM.`,
      );
      if (canvas) {
        const pageStart = ((pageNumber - 1) / pdf.numPages) * 80;
        const pageWeight = 80 / pdf.numPages;
        text = await recognizeImage(canvas, (ocrProgress) => {
          const bounded = Math.max(0, Math.min(100, ocrProgress));
          onProgress?.(Math.round(pageStart + pageWeight * (bounded / 100)));
        });
      }
    }
    pages.push({ page: pageNumber, text });
    onProgress?.(Math.round((pageNumber / pdf.numPages) * (usedOcr ? 80 : 100)));
  }
  if (!usedOcr) return { pages, usedOcr, ocrPages, ocrEnhancements: [] as OcrEnhancementDiagnostic[] };

  const initialExpected = expectedKindForAssessment(expected);
  const initial = structureDocument(pages, initialExpected, usedOcr, ocrPages);
  const initialAssessment = assessExtractionQuality(initial, initialExpected);
  const lowConfidencePages = new Set(initialAssessment.lowConfidencePages);
  const pageText = new Map(pages.map((page) => [page.page, page.text]));
  const enhancementPages = ocrPages
    .filter((page) => lowConfidencePages.has(page) || needsEnhancedOcr(pageText.get(page) || ""))
    .slice(0, 8);
  const ocrEnhancements: OcrEnhancementDiagnostic[] = [];
  for (let index = 0; index < enhancementPages.length; index += 1) {
    const pageNumber = enhancementPages[index];
    const page = await withTimeout(
      pdf.getPage(pageNumber),
      PDF_LOAD_TIMEOUT_MS,
      `El lector PDF no respondió al reabrir la página ${pageNumber} para amplificación.`,
    );
    const canvas = await withTimeout(
      renderPageCanvas(page),
      PDF_LOAD_TIMEOUT_MS,
      `El lector PDF no pudo preparar la segunda pasada de la página ${pageNumber}.`,
    );
    if (!canvas) continue;
    const enhanced = enhanceCanvas(canvas);
    const passProgress = (pass: number) => (value: number) => {
      const bounded = Math.max(0, Math.min(100, value));
      const passFraction = (index * 2 + pass + bounded / 100) / Math.max(1, enhancementPages.length * 2);
      onProgress?.(Math.round(80 + passFraction * 20));
    };
    const enhancedText = await recognizeImage(enhanced, passProgress(0), "6");
    const lineCrop = cropLineRegion(enhanced);
    const lineCropText = await recognizeImage(lineCrop, passProgress(1), "11");
    const primaryText = pageText.get(pageNumber) || "";
    const selected = chooseOcrText(primaryText, enhancedText, lineCropText);
    const pageIndex = pages.findIndex((item) => item.page === pageNumber);
    if (pageIndex >= 0) pages[pageIndex] = { page: pageNumber, text: selected.text };
    ocrEnhancements.push({
      page: pageNumber,
      selected: selected.selected,
      primaryScore: selected.primaryScore,
      selectedScore: selected.selectedScore,
      methods: ["renderizado 2.2x", "ampliación 1.45x", "escala de grises", "contraste", "reducción de ruido", "recorte de líneas", "OCR PSM 6/11"],
      candidates: selected.candidates.map(({ pass, score, text }) => ({ pass, score, textLength: text.length })),
    });
  }
  onProgress?.(100);
  return { pages, usedOcr, ocrPages, ocrEnhancements };
}

function expectedKindForAssessment(expected: ExpectedKind): "account" | "pam" {
  return expected === "pam" ? "pam" : "account";
}

export async function extractHealthcareDocument(
  file: File,
  expected: ExpectedKind,
  onProgress?: (progress: number) => void,
): Promise<DocumentExtraction> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { pages, usedOcr, ocrPages, ocrEnhancements } = await extractPdf(file, expected, onProgress);
    return structureDocument(pages, expected, usedOcr, ocrPages, ocrEnhancements);
  }
  if (file.type.startsWith("image/")) {
    const text = await recognizeImage(file, onProgress);
    onProgress?.(100);
    return structureDocument([{ page: 1, text }], expected, true);
  }
  throw new Error("El formato no permite extracción automática");
}

export function extractionErrorMessage(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/undefined is not a function|withResolvers|Promise\.try|lector PDF no respondió/i.test(raw)) {
    return "El navegador no pudo completar el lector PDF compatible. El original quedó conservado para reintento o revisión asistida.";
  }
  return raw || "Falló la extracción automática";
}
