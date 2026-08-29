import { structureDocument, type TextPage } from "./parsers.ts";
import { installPromiseWithResolversPolyfill } from "./promise-compat.ts";
import type { DocumentExtraction } from "./types.ts";

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

async function recognizeImage(image: File | HTMLCanvasElement, onProgress?: (progress: number) => void) {
  const worker = await withTimeout(
    getOcrWorker(),
    OCR_INITIALIZATION_TIMEOUT_MS,
    "El lector OCR no respondió a tiempo. Conserva el original para revisión humana o LLM externa.",
  );
  ocrProgressListener = onProgress;
  try {
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

async function extractPdf(file: File, onProgress?: (progress: number) => void) {
  installPromiseWithResolversPolyfill();
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(pdfWorkerUrl, {
      type: "module",
      name: "revisatucuenta-pdf",
    });
  }
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  let pdf;
  try {
    pdf = await withTimeout(
      loadingTask.promise,
      PDF_LOAD_TIMEOUT_MS,
      "El lector PDF no respondió a tiempo. Vuelve a cargar la cuenta o conserva el original para revisión humana/LLM.",
    );
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
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (context) {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const pageStart = ((pageNumber - 1) / pdf.numPages) * 100;
        const pageWeight = 100 / pdf.numPages;
        text = await recognizeImage(canvas, (ocrProgress) => {
          const bounded = Math.max(0, Math.min(100, ocrProgress));
          onProgress?.(Math.round(pageStart + pageWeight * (bounded / 100)));
        });
      }
    }
    pages.push({ page: pageNumber, text });
    onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
  }
  return { pages, usedOcr, ocrPages };
}

export async function extractHealthcareDocument(
  file: File,
  expected: ExpectedKind,
  onProgress?: (progress: number) => void,
): Promise<DocumentExtraction> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { pages, usedOcr, ocrPages } = await extractPdf(file, onProgress);
    return structureDocument(pages, expected, usedOcr, ocrPages);
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
  if (/undefined is not a function|withResolvers|lector PDF no respondió/i.test(raw)) {
    return "Este dispositivo no era compatible con el lector PDF. Se activó el modo compatible; vuelve a cargar la cuenta.";
  }
  return raw || "Falló la extracción automática";
}
