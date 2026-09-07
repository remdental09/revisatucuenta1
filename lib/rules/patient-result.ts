import type { ClinicalAccountAnalysis, InclusionCandidate } from "./chilean-account";

export const DISPUTE_CANDIDATE_THRESHOLD = 0.45;
export const DISPUTE_LLM_THRESHOLD = 0.7;

export type PatientResult = {
  available: boolean;
  hasDispute: boolean;
  disputeAmount: number;
};

function normalizeCandidateText(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The single candidate-selection path used by both the developer console and
 * the patient summary. Keeping this here prevents the two surfaces from
 * quietly summing different sets of lines.
 */
export function llmCandidateForLine(
  analysis: ClinicalAccountAnalysis | undefined,
  lineId: string,
  bundle?: "operating_room",
): InclusionCandidate | undefined {
  const sourceLine = analysis?.lineAssessments.find((item) => item.line.id === lineId)?.line;
  const description = normalizeCandidateText(`${sourceLine?.description || ""} ${sourceLine?.section || ""}`);
  if (/\bdia cama\b|\b(?:derecho de |derecho )?pabellon(?: quirurgico)?\b/.test(description)) return;
  const hypothesis = analysis?.llmAssist?.lineHypotheses
    .filter((item) =>
      item.lineId === lineId
      && item.decision === "review"
      && item.confidence >= DISPUTE_LLM_THRESHOLD
      && item.bundle !== "procedure"
      && item.bundle !== "professional_fees"
      && item.bundle !== "unassigned"
      && (!bundle || item.bundle === bundle),
    )
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (!hypothesis) return;
  return {
    bundle: hypothesis.bundle,
    probability: hypothesis.confidence,
    knowledgeIds: ["LLM-SECOND-READER-001"],
    precedentIds: [],
    precedentSupport: 0,
    reasons: [hypothesis.rationale, ...hypothesis.evidence].filter(Boolean),
    missingEvidence: hypothesis.missingEvidence,
  } satisfies InclusionCandidate;
}

export function bestCombinedCandidate(
  analysis: ClinicalAccountAnalysis | undefined,
  assessment: ClinicalAccountAnalysis["lineAssessments"][number],
  bundle?: "operating_room",
): InclusionCandidate | undefined {
  const deterministic = assessment.candidates
    .filter((candidate) => candidate.probability >= DISPUTE_CANDIDATE_THRESHOLD && (!bundle || candidate.bundle === bundle))
    .sort((left, right) => right.probability - left.probability)[0];
  const assisted = llmCandidateForLine(analysis, assessment.line.id, bundle);
  if (!deterministic) return assisted;
  if (!assisted) return deterministic;
  return assisted.probability > deterministic.probability ? assisted : deterministic;
}

export function possibleDisputeLines(analysis?: ClinicalAccountAnalysis) {
  return (analysis?.lineAssessments ?? [])
    .filter((assessment) => Boolean(bestCombinedCandidate(analysis, assessment)));
}

export function possibleDisputeAmount(analysis?: ClinicalAccountAnalysis) {
  return possibleDisputeLines(analysis)
    .reduce((sum, assessment) => sum + assessment.line.amount, 0);
}

/** Public patient-facing result. It intentionally excludes every line-level detail. */
export function buildPatientResult(analysis?: ClinicalAccountAnalysis): PatientResult {
  if (!analysis) return { available: false, hasDispute: false, disputeAmount: 0 };
  const disputeAmount = possibleDisputeAmount(analysis);
  return {
    available: true,
    hasDispute: disputeAmount > 0,
    disputeAmount: Math.round(disputeAmount),
  };
}
