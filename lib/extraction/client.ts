import { structureDocument, type TextPage } from "./parsers.ts";
import type { DocumentExtraction } from "./types.ts";

const pdfWorkerUrl = "/pdf.worker.min.mjs";

type ExpectedKind = "account" | "pam" | "mixed" | "unknown";

type PositionedTextItem = {
  str?: string;
  transform?: number[];
};

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

async function recognizeImage(image: File | HTMLCanvasElement) {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(image, "spa", {
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6",
  });
  return result.data.text;
}

async function extractPdf(file: File, onProgress?: (progress: number) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(pdfWorkerUrl, {
      type: "module",
      name: "revisatucuenta-pdf",
    });
  }
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: TextPage[] = [];
  const ocrPages: number[] = [];
  let usedOcr = false;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
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
        text = await recognizeImage(canvas);
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
    const text = await recognizeImage(file);
    onProgress?.(100);
    return structureDocument([{ page: 1, text }], expected, true);
  }
  throw new Error("El formato no permite extracción automática");
}
