// Increment this whenever the extraction rules change in a way that makes a
// previously persisted extraction unsafe to present as current.
export const CURRENT_READER_VERSION = "2026-08-30.1";

export type ExtractionField = {
  key: string;
  label: string;
  value: string;
  page: number;
  confidence: number;
  sourceText?: string;
  sourceRegion?: string;
};

export type ExtractedLine = {
  description: string;
  amount: number;
  page: number;
  date?: string;
  code?: string;
  fonasaCode?: string;
  section?: string;
  subgroup?: string;
  providerId?: string;
  quantity?: number;
  unitAmount?: number;
  numericReconciled?: boolean;
  confidence?: number;
  sourceText?: string;
  sourceRegion?: string;
};

export type StructuredExtraction = {
  type: "account" | "pam";
  label: string;
  pages: number[];
  fields: ExtractionField[];
  lines: ExtractedLine[];
};

export type ReaderAssessmentStatus = "ready" | "review_required" | "reader_change_needed";

export type ReaderUnknownItem = {
  value: string;
  page: number;
  reason: string;
  confidence: number;
};

export type ReaderAssessment = {
  status: ReaderAssessmentStatus;
  parserMode: "direct_pdf" | "ocr" | "mixed";
  confidence: number;
  templateFingerprint: string;
  unknownItems: ReaderUnknownItem[];
  numericIssues: ReaderUnknownItem[];
  lowConfidencePages: number[];
  signals: string[];
  nextAction: string;
  codeChangeNeeded: boolean;
  llmAssist: {
    status: "not_configured" | "ready_for_review";
    role: "assistive_only";
    contractVersion: string;
  };
};

export type OcrEnhancementDiagnostic = {
  page: number;
  selected: "primary" | "enhanced" | "line_crop";
  primaryScore: number;
  selectedScore: number;
  methods: string[];
  candidates: Array<{
    pass: "primary" | "enhanced" | "line_crop";
    score: number;
    textLength: number;
  }>;
};

export type ReaderAssistFieldProposal = {
  key: string;
  label: string;
  value: string;
  page: number;
  evidence: string;
  confidence: number;
};

export type ReaderAssistLineCorrection = {
  index: number;
  page: number;
  description: string;
  code: string | null;
  quantity: number | null;
  unitAmount: number | null;
  amount: number | null;
  evidence: string;
  confidence: number;
  reason: string;
};

export type ReaderAssistUnknownItem = {
  value: string;
  page: number;
  evidence: string;
  reason: string;
  confidence: number;
};

export type ReaderAssistResult = {
  status: "assisted" | "insufficient_evidence";
  summary: string;
  fields: ReaderAssistFieldProposal[];
  lineCorrections: ReaderAssistLineCorrection[];
  unknownItems: ReaderAssistUnknownItem[];
  safetyNotes: string[];
};

export type ReaderAssistResponse = {
  status: "ready_for_review" | "insufficient_evidence";
  model: string;
  result: ReaderAssistResult;
  warnings: string[];
};

export type DocumentExtraction = {
  readerVersion?: string;
  pageCount: number;
  usedOcr: boolean;
  ocrPages?: number[];
  ocrEnhancements?: OcrEnhancementDiagnostic[];
  pageKinds?: Array<{
    page: number;
    kind: "account" | "pam" | "unknown";
  }>;
  readerAssessment?: ReaderAssessment;
  account?: StructuredExtraction;
  pam?: StructuredExtraction;
};
