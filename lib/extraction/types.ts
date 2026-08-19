export type ExtractionField = {
  key: string;
  label: string;
  value: string;
  page: number;
  confidence: number;
};

export type ExtractedLine = {
  description: string;
  amount: number;
  page: number;
  code?: string;
  fonasaCode?: string;
  section?: string;
  quantity?: number;
  unitAmount?: number;
};

export type StructuredExtraction = {
  type: "account" | "pam";
  label: string;
  pages: number[];
  fields: ExtractionField[];
  lines: ExtractedLine[];
};

export type DocumentExtraction = {
  pageCount: number;
  usedOcr: boolean;
  account?: StructuredExtraction;
  pam?: StructuredExtraction;
};
