import { getCloudflareEnv } from "../../../lib/server/runtime-store.ts";
import {
  buildCorpusContribution,
  getObservedCorpusSnapshot,
  registerCorpusContribution,
  type CorpusSourceKind,
} from "../../../lib/server/observed-corpus-store.ts";
import type { ChileanBillingLine } from "../../../lib/rules/chilean-account.ts";
import { requireApiUser } from "../../../lib/server/auth.ts";
import { caseAccessResponse, developerAccessResponse } from "../../../lib/server/case-access.ts";

type CorpusObservationRequest = {
  caseId?: string;
  episodeClass?: string;
  sourceKind?: CorpusSourceKind;
  sourceDocumentId?: string;
  lines?: unknown;
};

function isBillingLine(value: unknown): value is ChileanBillingLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === "string" &&
    line.id.length > 0 &&
    typeof line.description === "string" &&
    line.description.length > 0 &&
    typeof line.amount === "number" &&
    Number.isFinite(line.amount) &&
    typeof line.page === "number" &&
    Number.isInteger(line.page) &&
    line.page > 0
  );
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const denied = developerAccessResponse(auth.user);
  if (denied) return denied;
  const env = await getCloudflareEnv();
  const requestedKind = new URL(request.url).searchParams.get("sourceKind");
  const sourceKind: CorpusSourceKind = requestedKind === "pam" ? "pam" : "account";
  const snapshot = await getObservedCorpusSnapshot(env, sourceKind);
  return Response.json({
    sourceKind,
    version: snapshot.corpus.version,
    caseCount: snapshot.corpus.caseCount,
    observationCount: snapshot.corpus.observationCount,
    patternCount: snapshot.corpus.patternCount,
    pendingContributionCount: snapshot.pendingCount,
    validatedContributionCount: snapshot.validatedCount,
    learningBoundary: snapshot.corpus.learningBoundary,
  });
}

/**
 * Registers account or PAM observations as soon as a document arrives.
 * Pending observations are visible to the review queue but never affect the
 * active corpus until a human validates the case.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as CorpusObservationRequest;
  if (!body.caseId || !body.sourceKind || !["account", "pam"].includes(body.sourceKind)) {
    return Response.json({ error: "Se requiere caso y tipo de fuente account o pam" }, { status: 422 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0 || !body.lines.every(isBillingLine)) {
    return Response.json({ error: "La observación requiere líneas extraídas con id, monto y página" }, { status: 422 });
  }
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, body.caseId, auth.user);
  if (denied) return denied;
  const contribution = buildCorpusContribution({
    caseId: body.caseId,
    episodeClass: body.episodeClass || (body.sourceKind === "pam" ? "PAM / liquidación" : "Cuenta clínica"),
    sourceKind: body.sourceKind,
    sourceDocumentId: body.sourceDocumentId,
    lines: body.lines,
  });
  const status = await registerCorpusContribution(env, body.caseId, contribution);
  const snapshot = await getObservedCorpusSnapshot(env, body.sourceKind);
  return Response.json({
    caseId: body.caseId,
    sourceKind: body.sourceKind,
    status,
    activeInCorpus: status === "validated",
    addedToReviewQueue: true,
    caseCount: snapshot.corpus.caseCount,
    observationCount: snapshot.corpus.observationCount,
    patternCount: snapshot.corpus.patternCount,
    pendingContributionCount: snapshot.pendingCount,
    validatedContributionCount: snapshot.validatedCount,
    message: status === "validated"
      ? "La observación ya estaba validada y permanece activa en el corpus."
      : "La observación fue registrada y quedó pendiente de validación humana.",
  });
}
