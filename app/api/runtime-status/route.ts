import { getCloudflareEnv } from "../../../lib/server/runtime-store.ts";
import { authSessionSecret, emailAuthenticationConfigured, isDeveloperUser, requireApiUser } from "../../../lib/server/auth.ts";
import { isReaderAssistConfigured, readerAssistModel } from "../../../lib/server/openai-reader-assist.ts";

/**
 * Safe, developer-only diagnostics for production configuration.
 * Never returns secret values; it only reports presence and selected runtime
 * capabilities so an operator can distinguish an environment problem from
 * an application routing problem.
 */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  if (!isDeveloperUser(auth.user)) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const env = await getCloudflareEnv();
  const hasProcess = typeof process !== "undefined";
  const runtimeApiKeyPresent = Boolean(hasProcess && process.env.OPENAI_API_KEY?.trim());
  const environmentApiKeyPresent = Boolean(env && typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim());
  const nodeRuntime = Boolean(
    hasProcess && (
      process.env.REVISA_NODE_RUNTIME === "true" ||
      process.env.REVISA_DATA_DIR?.trim() ||
      process.env.RAILWAY_ENVIRONMENT?.trim() ||
      process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
    ),
  );

  return Response.json({
    ok: true,
    nodeRuntime,
    runtimeApiKeyPresent,
    environmentApiKeyPresent,
    readerAssistConfigured: isReaderAssistConfigured(env),
    model: readerAssistModel(env),
    modelRoutingPresent: Boolean(
      (hasProcess && process.env.OPENAI_MODEL_ROUTING?.trim()) ||
      (env && typeof env.OPENAI_MODEL_ROUTING === "string" && env.OPENAI_MODEL_ROUTING.trim()),
    ),
    emailSessionSecretPresent: Boolean(authSessionSecret()),
    resendApiKeyPresent: Boolean(
      (hasProcess && process.env.RESEND_API_KEY?.trim()) ||
      (env && typeof env.RESEND_API_KEY === "string" && env.RESEND_API_KEY.trim()),
    ),
    emailSenderPresent: Boolean(
      (hasProcess && process.env.AUTH_EMAIL_FROM?.trim()) ||
      (env && typeof env.AUTH_EMAIL_FROM === "string" && env.AUTH_EMAIL_FROM.trim()),
    ),
    emailAuthenticationConfigured: emailAuthenticationConfigured(),
    databaseAvailable: Boolean(env?.DB),
    documentsAvailable: Boolean(env?.DOCUMENTS),
    dataDirectoryPresent: Boolean(hasProcess && process.env.REVISA_DATA_DIR?.trim()),
  }, { headers: { "cache-control": "no-store" } });
}
