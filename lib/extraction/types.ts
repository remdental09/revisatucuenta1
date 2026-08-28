// Increment this whenever the extraction rules change in a way that makes a
// previously persisted extraction unsafe to present as current.
export const CURRENT_READER_VERSION = "2026-08-28.1";

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
  providerId?: string;
  quantity?: number;
  unitAmount?: number;
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

export type DocumentExtraction = {
  readerVersion?: string;
  pageCount: number;
  usedOcr: boolean;
  ocrPages?: number[];
  readerAssessment?: ReaderAssessment;
  account?: StructuredExtraction;
  pam?: StructuredExtraction;
};
