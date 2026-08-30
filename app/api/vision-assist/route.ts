import type { DocumentExtraction, VisionPageImage } from "../../../lib/extraction/types.ts";
import { developerAccessResponse, documentAccess } from "../../../lib/server/case-access.ts";
import { requireApiUser } from "../../../lib/server/auth.ts";
import { getCloudflareEnv } from "../../../lib/server/runtime-store.ts";
import { ReaderAssistError, buildReaderAssistContext } from "../../../lib/server/openai-reader-assist.ts";
import { isVisionPageImage, requestVisionAssist } from "../../../lib/server/openai-vision-assist.ts";

type VisionAssistRequest = {
  caseId?: unknown;
  documentId?: unknown;
  expectedKind?: unknown;
  extraction?: unknown;
  images?: unknown;
};

function isStructuredGroup(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const group = value as Record<string, unknown>;
  return Array.isArray(group.fields) && Array.isArray(group.lines) && group.lines.length <= 10_000 && group.lines.every((line) => {
    if (!line || typeof line !== "object") return false;
    const item = line as Record<string, unknown>;
    return typeof item.description === "string" && item.description.length > 0 && typeof item.page === "number" && Number.isInteger(item.page) && item.page > 0 && typeof item.amount === "number" && Number.isFinite(item.amount);
  });
}

function isDocumentExtraction(value: unknown): value is DocumentExtraction {
  if (!value || typeof value !== "object") return false;
  const extraction = value as Record<string, unknown>;
  return typeof extraction.pageCount === "number" && Number.isInteger(extraction.pageCount) && extraction.pageCount >= 0 && typeof extraction.usedOcr === "boolean" && (!extraction.account || isStructuredGroup(extraction.account)) && (!extraction.pam || isStructuredGroup(extraction.pam));
}

function validImages(value: unknown): value is VisionPageImage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return false;
  const images = value.filter(isVisionPageImage);
  return images.length === value.length && new Set(images.map((image) => image.page)).size <= 4 && images.reduce((total, image) => total + image.dataUrl.length, 0) <= 48_000_000;
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const developerDenied = developerAccessResponse(auth.user);
  if (developerDenied) return developerDenied;

  let body: VisionAssistRequest;
  try {
    body = await request.json() as VisionAssistRequest;
  } catch {
    return Response.json({ error: "Solicitud JSON inválida" }, { status: 400 });
  }
  const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  const expectedKind = body.expectedKind === "pam" ? "pam" : "account";
  if (!caseId || !documentId) return Response.json({ error: "Caso o documento ausente" }, { status: 400 });
  if (!isDocumentExtraction(body.extraction)) return Response.json({ error: "La evidencia de extracción no tiene un formato válido" }, { status: 422 });
  if (!validImages(body.images)) return Response.json({ code: "INVALID_VISION_IMAGES", error: "La solicitud debe contener hasta cuatro páginas y 64 zonas en imágenes JPEG, PNG o WebP." }, { status: 422 });

  const env = await getCloudflareEnv();
  const access = await documentAccess(env, documentId, auth.user);
  if ("response" in access) return access.response;
  if (access.caseId !== caseId) return Response.json({ error: "Documento no asociado al caso" }, { status: 404 });

  try {
    const context = buildReaderAssistContext(body.extraction, expectedKind);
    const result = await requestVisionAssist(context, body.images, env);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ReaderAssistError) return Response.json({ code: error.code, error: error.message }, { status: error.status });
    return Response.json({ code: "LLM_PROVIDER_ERROR", error: "No se pudo completar la lectura visual auxiliar." }, { status: 502 });
  }
}
