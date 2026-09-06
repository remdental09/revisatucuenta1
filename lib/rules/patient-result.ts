import type { ClinicalAccountAnalysis, InclusionCandidate } from "./chilean-account";

const PATIENT_CANDIDATE_THRESHOLD = 0.45;
const PATIENT_LLM_THRESHOLD = 0.7;

export type PatientResult = {
  available: boolean;
  hasDispute: boolean;
  disputeAmount: number;
};

function bestPatientCandidate(analysis: ClinicalAccountAnalysis, assessment: ClinicalAccountAnalysis["lineAssessments"][number]): InclusionCandidate | undefined {
  const deterministic = assessment.candidates
    .filter((candidate) => candidate.probability >= PATIENT_CANDIDATE_THRESHOLD)
    .sort((left, right) => right.probability - left.probability)[0];
  const sourceLine = assessment.line;
  const description = `${sourceLine.description} ${sourceLine.section || ""}`.toLowerCase();
  const hypothesis = analysis.llmAssist?.lineHypotheses
    .filter((item) =>
      item.lineId === sourceLine.id
      && item.decision === "review"
      && item.confidence >= PATIENT_LLM_THRESHOLD
      && item.bundle !== "procedure"
      && item.bundle !== "professional_fees"
      && item.bundle !== "unassigned"
      && !/\bdia cama\b|\bpabell[oó]n(?: quir[uú]rgico)?\b/.test(description),
    )
    .sort((left, right) => right.confidence - left.confidence)[0];
  const assisted = hypothesis ? {
    bundle: hypothesis.bundle,
    probability: hypothesis.confidence,
    knowledgeIds: ["LLM-SECOND-READER-001"],
    precedentIds: [],
    precedentSupport: 0,
    reasons: [hypothesis.rationale, ...hypothesis.evidence].filter(Boolean),
    missingEvidence: hypothesis.missingEvidence,
  } satisfies InclusionCandidate : undefined;
  if (!deterministic) return assisted;
  if (!assisted) return deterministic;
  return assisted.probability > deterministic.probability ? assisted : deterministic;
}

/** Public patient-facing result. It intentionally excludes every line-level detail. */
export function buildPatientResult(analysis?: ClinicalAccountAnalysis): PatientResult {
  if (!analysis) return { available: false, hasDispute: false, disputeAmount: 0 };
  const disputeAmount = analysis.lineAssessments
    .filter((assessment) => Boolean(bestPatientCandidate(analysis, assessment)))
    .reduce((sum, assessment) => sum + assessment.line.amount, 0);
  return {
    available: true,
    hasDispute: disputeAmount > 0,
    disputeAmount: Math.round(disputeAmount),
  };
}
