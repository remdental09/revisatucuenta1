type RuntimeEnvironment = Record<string, unknown> | null | undefined;

export type SupportChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SupportChatResponse = {
  message: string;
  escalate: boolean;
  model: string;
};

export type SupportChatFailureCode =
  | "LLM_NOT_CONFIGURED"
  | "LLM_AUTHENTICATION_FAILED"
  | "LLM_RATE_LIMITED"
  | "LLM_PROVIDER_UNAVAILABLE"
  | "LLM_PROVIDER_ERROR"
  | "LLM_INVALID_RESPONSE";

export class SupportChatError extends Error {
  code: SupportChatFailureCode;
  status: number;

  constructor(code: SupportChatFailureCode, message: string, status: number) {
    super(message);
    this.name = "SupportChatError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_MODEL = "gpt-5.4-mini";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_LENGTH = 1_200;

function runtimeValue(name: string) {
  if (typeof process === "undefined") return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

function environmentValue(env: RuntimeEnvironment, name: string) {
  const value = env && typeof env[name] === "string" ? env[name] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveApiKey(env: RuntimeEnvironment) {
  return runtimeValue("OPENAI_API_KEY") || environmentValue(env, "OPENAI_API_KEY");
}

function resolveModel(env: RuntimeEnvironment) {
  return runtimeValue("OPENAI_CHAT_MODEL")
    || environmentValue(env, "OPENAI_CHAT_MODEL")
    || runtimeValue("OPENAI_READER_MODEL")
    || environmentValue(env, "OPENAI_READER_MODEL")
    || DEFAULT_MODEL;
}

function capText(value: string, max = MAX_MESSAGE_LENGTH) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Remove identifiers before general support questions reach the model. */
export function sanitizeSupportMessage(value: string) {
  return capText(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[correo omitido]")
    .replace(/\b\d{1,2}(?:\.\d{3}){2}[-\s]?[0-9kK]\b/g, "[RUT omitido]")
    .replace(/\b(?:\+?56\s*)?9\s*\d{4}\s*\d{4}\b/g, "[teléfono omitido]");
}

const supportChatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "escalate"],
  properties: {
    message: { type: "string" },
    escalate: { type: "boolean" },
  },
} as const;

const SYSTEM_INSTRUCTIONS = [
  "Eres el asistente de orientación general de RevisaTuCuenta para pacientes en Chile.",
  "Responde en español claro, breve y cordial, con un máximo de 120 palabras.",
  "Orienta sobre cuentas de hospitalización, cuentas detalladas, PAM, coberturas, resultados preliminares, privacidad y pasos para usar el portal.",
  "No pidas ni proceses RUN, nombres completos, correos, teléfonos, documentos ni datos clínicos en este chat.",
  "Si el usuario comparte un dato sensible, indícale que no lo envíe por el chat y que use el acceso seguro.",
  "No declares que existe fraude, ilegalidad o un cobro indebido; usa expresiones como 'conviene revisar' o 'posible inconsistencia'.",
  "No prometas devoluciones, resultados, cobertura ni éxito de un reclamo.",
  "No reemplazas asesoría médica, legal, financiera ni la decisión del prestador o asegurador.",
  "Si piden revisar un caso concreto, un reclamo, una conclusión legal o hablar con una persona, responde que corresponde derivar a atención humana y marca escalate=true.",
  "No inventes datos del caso, montos, códigos, coberturas ni plazos.",
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

function parseSupportChatResponse(payload: unknown) {
  const text = responseOutputText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (typeof value.message !== "string" || !value.message.trim() || typeof value.escalate !== "boolean") {
      throw new Error("invalid shape");
    }
    return {
      message: capText(value.message, 1_000),
      escalate: value.escalate,
    };
  } catch {
    throw new SupportChatError("LLM_INVALID_RESPONSE", "La respuesta del asistente no pudo validarse.", 502);
  }
}

export async function requestSupportChat(
  messages: SupportChatMessage[],
  env?: RuntimeEnvironment,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SupportChatResponse> {
  const apiKey = resolveApiKey(env);
  const model = resolveModel(env);
  if (!apiKey) throw new SupportChatError("LLM_NOT_CONFIGURED", "El asistente ampliado no está configurado en este entorno.", 503);

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
          ...messages.slice(-12).map((message) => ({
            role: message.role,
            content: [{ type: "input_text", text: sanitizeSupportMessage(message.content) }],
          })),
        ],
        text: { format: { type: "json_schema", name: "support_chat_result", strict: true, schema: supportChatSchema } },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new SupportChatError("LLM_AUTHENTICATION_FAILED", "La clave de IA no fue aceptada por el proveedor.", 502);
      if (response.status === 429) throw new SupportChatError("LLM_RATE_LIMITED", "El asistente alcanzó temporalmente su límite de uso.", 429);
      if (response.status >= 500) throw new SupportChatError("LLM_PROVIDER_UNAVAILABLE", "El proveedor de IA no está disponible en este momento.", 502);
      throw new SupportChatError("LLM_PROVIDER_ERROR", "El proveedor rechazó la consulta.", 502);
    }
    const result = parseSupportChatResponse(await response.json());
    return { ...result, model };
  } catch (error) {
    if (error instanceof SupportChatError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SupportChatError("LLM_PROVIDER_UNAVAILABLE", "El asistente tardó demasiado. Puedes continuar con atención humana.", 504);
    }
    throw new SupportChatError("LLM_PROVIDER_ERROR", "No se pudo completar la consulta al asistente.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
