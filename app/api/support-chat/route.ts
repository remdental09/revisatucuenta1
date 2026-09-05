import { getCloudflareEnv } from "../../../lib/server/runtime-store.ts";
import {
  requestSupportChat,
  sanitizeSupportMessage,
  SupportChatError,
  type SupportChatMessage,
} from "../../../lib/server/openai-support-chat.ts";

type SupportChatRequest = { messages?: unknown };

const ALLOWED_ORIGINS = new Set([
  "https://revisatucuenta.cl",
  "https://www.revisatucuenta.cl",
  "https://revisatucuenta-mvp.luispaul.chatgpt.site",
]);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 20;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();

function corsHeaders(request: Request) {
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  return headers;
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "anonymous";
}

function rateLimitExceeded(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const current = requestBuckets.get(key);
  if (!current || current.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

function isMessage(value: unknown): value is SupportChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string"
    && message.content.trim().length > 0
    && message.content.length <= 1_500;
}

export async function POST(request: Request) {
  if (rateLimitExceeded(request)) {
    return Response.json({ code: "RATE_LIMITED", error: "Has alcanzado el límite temporal de consultas. Intenta nuevamente más tarde." }, { status: 429, headers: corsHeaders(request) });
  }
  let body: SupportChatRequest;
  try {
    body = await request.json() as SupportChatRequest;
  } catch {
    return Response.json({ code: "INVALID_REQUEST", error: "Solicitud JSON inválida." }, { status: 400, headers: corsHeaders(request) });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 16 || !body.messages.every(isMessage)) {
    return Response.json({ code: "INVALID_REQUEST", error: "La conversación no tiene un formato válido." }, { status: 400, headers: corsHeaders(request) });
  }
  const messages = body.messages.slice(-12).map((message) => ({
    role: message.role,
    content: sanitizeSupportMessage(message.content),
  }));
  if (messages[messages.length - 1]?.role !== "user") {
    return Response.json({ code: "INVALID_REQUEST", error: "La última intervención debe ser del paciente." }, { status: 400, headers: corsHeaders(request) });
  }

  try {
    const result = await requestSupportChat(messages, await getCloudflareEnv());
    return Response.json(result, { headers: corsHeaders(request) });
  } catch (error) {
    if (error instanceof SupportChatError) {
      return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: corsHeaders(request) });
    }
    return Response.json({ code: "LLM_PROVIDER_ERROR", error: "No se pudo completar la consulta al asistente." }, { status: 502, headers: corsHeaders(request) });
  }
}

export function OPTIONS(request: Request) {
  const headers = corsHeaders(request);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(null, { status: 204, headers });
}
