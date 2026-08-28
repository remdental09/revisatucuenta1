import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";
import { getCloudflareEnv, localGetCase } from "../../../../../lib/server/runtime-store.ts";
import {
  getCorpusContributionStatus,
  getObservedCorpusSnapshot,
  updateCorpusContributionStatus,
  type CorpusContributionStatus,
} from "../../../../../lib/server/observed-corpus-store.ts";
import { requireApiUser } from "../../../../../lib/server/auth.ts";
import { caseAccessResponse, developerAccessResponse } from "../../../../../lib/server/case-access.ts";

const ALLOWED_STATUSES: CorpusContributionStatus[] = ["pending_review", "validated", "rejected"];

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;
  const status = await getCorpusContributionStatus(env, id);
  if (!status) return Response.json({ error: "La cuenta todavía no tiene una observación de corpus" }, { status: 404 });
  const snapshot = await getObservedCorpusSnapshot(env, "account");
  return Response.json({
    caseId: id,
    status,
    activeInCorpus: status === "validated",
    caseCount: snapshot.corpus.caseCount,
    observationCount: snapshot.corpus.observationCount,
    patternCount: snapshot.corpus.patternCount,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const developerDenied = developerAccessResponse(auth.user);
  if (developerDenied) return developerDenied;
  const body = await request.json().catch(() => ({})) as { status?: CorpusContributionStatus };
  if (!body.status || !ALLOWED_STATUSES.includes(body.status)) {
    return Response.json({ error: "Estado de corpus inválido" }, { status: 422 });
  }
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;
  if (!env?.DB && !localGetCase(id, auth.user.id, true)) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  if (env?.DB) {
    await ensureCaseSchema(env.DB);
    const exists = await env.DB.prepare(`SELECT id FROM cases WHERE id = ?`).bind(id).first();
    if (!exists) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  }
  const updated = await updateCorpusContributionStatus(env, id, body.status);
  if (!updated) return Response.json({ error: "La cuenta todavía no tiene una observación de corpus" }, { status: 404 });
  const snapshot = await getObservedCorpusSnapshot(env, "account");
  return Response.json({
    caseId: id,
    status: body.status,
    activeInCorpus: body.status === "validated",
    caseCount: snapshot.corpus.caseCount,
    observationCount: snapshot.corpus.observationCount,
    patternCount: snapshot.corpus.patternCount,
    message: body.status === "validated"
      ? "La cuenta fue incorporada como observación validada al corpus activo."
      : body.status === "rejected"
        ? "La cuenta quedó fuera del corpus activo y se conserva como revisión no incorporada."
        : "La cuenta volvió a quedar pendiente de revisión interna.",
  });
}
