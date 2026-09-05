import { getCloudflareEnv } from "../../../lib/server/runtime-store.ts";
import {
  requestSupportChat,
  sanitizeSupportMessage,
  SupportChatError,
  type SupportChatMessage,
} from "../../../lib/server/openai-support-chat.ts";

type SupportChatRequest = { messages?: unknown };

function isMessage(value: unknown): value is SupportChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string"
    && message.content.trim().length > 0
    && message.content.length <= 1_500;
}

export async function POST(request: Request) {
  let body: SupportChatRequest;
  try {
    body = await request.json() as SupportChatRequest;
  } catch {
    return Response.json({ code: "INVALID_REQUEST", error: "Solicitud JSON inválida." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 16 || !body.messages.every(isMessage)) {
    return Response.json({ code: "INVALID_REQUEST", error: "La conversación no tiene un formato válido." }, { status: 400 });
  }
  const messages = body.messages.slice(-12).map((message) => ({
    role: message.role,
    content: sanitizeSupportMessage(message.content),
  }));
  if (messages[messages.length - 1]?.role !== "user") {
    return Response.json({ code: "INVALID_REQUEST", error: "La última intervención debe ser del paciente." }, { status: 400 });
  }

  try {
    const result = await requestSupportChat(messages, await getCloudflareEnv());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SupportChatError) {
      return Response.json({ code: error.code, error: error.message }, { status: error.status });
    }
    return Response.json({ code: "LLM_PROVIDER_ERROR", error: "No se pudo completar la consulta al asistente." }, { status: 502 });
  }
}
