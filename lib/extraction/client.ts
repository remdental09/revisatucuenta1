import { structureDocument, type TextPage } from "./parsers";
import type { DocumentExtraction } from "./types";

const pdfWorkerUrl = "/pdf.worker.min.mjs";

type ExpectedKind = "account" | "pam" | "mixed" | "unknown";

async function recognizeImage(image: File | HTMLCanvasElement) {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(image, "spa");
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
  let usedOcr = false;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s{2,}/g, " ");
    if (text.replace(/\s/g, "").length < 60) {
      usedOcr = true;
      const viewport = page.getViewport({ scale: 1.6 });
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
  return { pages, usedOcr };
}

export async function extractHealthcareDocument(
  file: File,
  expected: ExpectedKind,
  onProgress?: (progress: number) => void,
): Promise<DocumentExtraction> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { pages, usedOcr } = await extractPdf(file, onProgress);
    return structureDocument(pages, expected, usedOcr);
  }
  if (file.type.startsWith("image/")) {
    const text = await recognizeImage(file);
    onProgress?.(100);
    return structureDocument([{ page: 1, text }], expected, true);
  }
  throw new Error("El formato no permite extracción automática");
}
