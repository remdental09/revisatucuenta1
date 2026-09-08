import type { ReaderAssessment } from "../extraction/types.ts";

export type LlmRouteTier = "routine" | "review" | "exceptional";

export type LlmRoute = {
  tier: LlmRouteTier;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  reason: string;
};

type RuntimeEnvironment = Record<string, unknown> | null | undefined;

function value(env: RuntimeEnvironment, name: string) {
  const fromProcess = typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
  const fromBinding = env && typeof env[name] === "string" ? String(env[name]).trim() : undefined;
  return fromProcess || fromBinding || undefined;
}

/**
 * Routes only anomalous readings to a stronger model. The routine model stays
 * configurable and is also used as a safe fallback if the account has not
 * been granted access to an escalation model.
 */
export function selectLlmRoute(input: {
  baseModel: string;
  env?: RuntimeEnvironment;
  assessment?: Pick<ReaderAssessment, "status" | "confidence" | "unknownItems" | "numericIssues" | "lowConfidencePages">;
  lineCount?: number;
  hasVision?: boolean;
  modelOverride?: string;
}): LlmRoute {
  if (input.modelOverride?.trim()) return { tier: "routine", model: input.modelOverride.trim(), reason: "Modelo solicitado explícitamente por la operación." };
  // Keep existing test and development probes deterministic. Production can
  // enable escalation explicitly with OPENAI_MODEL_ROUTING=true after the
  // account's model access has been verified.
  if (value(input.env, "OPENAI_MODEL_ROUTING") !== "true") {
    return { tier: "routine", model: input.baseModel, reasoningEffort: "low", reason: "Enrutamiento avanzado desactivado; se usa el modelo base configurado." };
  }
  const assessment = input.assessment;
  const unknownCount = assessment?.unknownItems.length ?? 0;
  const numericCount = assessment?.numericIssues.length ?? 0;
  const lowPages = assessment?.lowConfidencePages.length ?? 0;
  const exceptional = (assessment?.confidence ?? 1) < 0.45 || numericCount >= 2 || unknownCount >= 4 || (input.lineCount ?? 0) > 600;
  const review = exceptional || assessment?.status === "reader_change_needed" || (assessment?.confidence ?? 1) < 0.70 || numericCount > 0 || unknownCount > 0 || lowPages > 0 || Boolean(input.hasVision);
  if (exceptional) {
    return {
      tier: "exceptional",
      model: value(input.env, "OPENAI_EXCEPTION_MODEL") || "gpt-6-astra",
      reasoningEffort: "xhigh",
      reason: "Lectura de alto riesgo: varias inconsistencias, baja confianza o cuenta extensa.",
    };
  }
  if (review) {
    return {
      tier: "review",
      model: value(input.env, "OPENAI_REVIEW_MODEL") || "gpt-5.6-sol",
      reasoningEffort: "high",
      reason: "Lectura con señales de OCR, baja confianza o diferencias numéricas.",
    };
  }
  return { tier: "routine", model: input.baseModel, reasoningEffort: "low", reason: "Lectura estructurada sin señales de escalamiento." };
}

export function isModelAccessError(status: number) {
  return status === 400 || status === 404;
}
