import corpusData from "../../data/learning/observed-item-patterns.json" with { type: "json" };

export type ObservedItemPattern = {
  description: string;
  normalizedDescription: string;
  aliases: string[];
  codes: string[];
  fonasaCodes: string[];
  providers: string[];
  sections: string[];
  caseKeys: string[];
  observationCount: number;
  zeroValueCount: number;
  refundCount: number;
  unitPriceMin: number | null;
  unitPriceMax: number | null;
  totalMin: number | null;
  totalMax: number | null;
};

export type ObservedCorpusCase = {
  caseKey: string;
  provider: string;
  episodeClass: string;
  sourceLineCount: number;
  observedLineCount: number;
  coverage:
    | "source_total_reconciled"
    | "verified_fragmentation_subset"
    | "clinical_items_complete_professional_partial";
  coverageNote: string;
};

export type ObservedCorpus = {
  version: string;
  privacy: string;
  learningBoundary: string;
  caseCount: number;
  observationCount: number;
  patternCount: number;
  cases: ObservedCorpusCase[];
  patterns: ObservedItemPattern[];
};

export type CorpusLookupLine = {
  description: string;
  code?: string;
  fonasaCode?: string;
};

export type ObservedEquivalent = {
  description: string;
  equivalenceProbability: number;
  matchBasis: "same_description" | "same_item_code" | "same_fonasa_code" | "similar_name";
  observationCount: number;
  caseCount: number;
  providerCount: number;
  caseKeys: string[];
  providers: string[];
  sections: string[];
  codes: string[];
  fonasaCodes: string[];
  zeroValueRate: number;
  refundRate: number;
};

export const OBSERVED_CHILEAN_ACCOUNT_CORPUS = corpusData as ObservedCorpus;

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP_TOKENS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "sin", "para", "por",
  "un", "una", "y", "o", "en", "sol", "desc", "desechable", "descartable", "esteril",
  "iny", "inyectable", "unidad", "unidades",
]);

function tokens(value: string) {
  const comparable = normalize(value)
    .replace(/\bluerlock\b/g, "luer lock")
    .replace(/\bcc\b/g, "ml");
  return new Set(
    comparable
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_TOKENS.has(token)),
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function scorePattern(line: CorpusLookupLine, pattern: ObservedItemPattern) {
  const description = normalize(line.description);
  if (description && description === pattern.normalizedDescription) {
    return { probability: 0.99, basis: "same_description" as const };
  }
  if (line.code && pattern.codes.includes(line.code)) {
    return { probability: 0.97, basis: "same_item_code" as const };
  }
  const nameSimilarity = jaccard(tokens(line.description), tokens(pattern.description));
  if (
    line.fonasaCode &&
    pattern.fonasaCodes.includes(line.fonasaCode) &&
    nameSimilarity >= 0.25
  ) {
    return { probability: Math.min(0.93, 0.78 + nameSimilarity * 0.15), basis: "same_fonasa_code" as const };
  }
  if (nameSimilarity >= 0.42) {
    return {
      probability: Math.min(0.94, 0.38 + nameSimilarity * 0.56),
      basis: "similar_name" as const,
    };
  }
  return null;
}

/**
 * Estimates whether a new line is equivalent to something already observed.
 * It deliberately does not decide whether the separate charge is allowed.
 */
export function findObservedEquivalents(
  line: CorpusLookupLine,
  limit = 5,
): ObservedEquivalent[] {
  return OBSERVED_CHILEAN_ACCOUNT_CORPUS.patterns
    .map((pattern) => ({ pattern, score: scorePattern(line, pattern) }))
    .filter(
      (entry): entry is { pattern: ObservedItemPattern; score: NonNullable<ReturnType<typeof scorePattern>> } =>
        entry.score !== null,
    )
    .sort((left, right) =>
      right.score.probability - left.score.probability ||
      right.pattern.observationCount - left.pattern.observationCount,
    )
    .slice(0, Math.max(0, limit))
    .map(({ pattern, score }) => ({
      description: pattern.description,
      equivalenceProbability: Number(score.probability.toFixed(3)),
      matchBasis: score.basis,
      observationCount: pattern.observationCount,
      caseCount: pattern.caseKeys.length,
      providerCount: pattern.providers.length,
      caseKeys: pattern.caseKeys,
      providers: pattern.providers,
      sections: pattern.sections,
      codes: pattern.codes,
      fonasaCodes: pattern.fonasaCodes,
      zeroValueRate: pattern.observationCount
        ? pattern.zeroValueCount / pattern.observationCount
        : 0,
      refundRate: pattern.observationCount
        ? pattern.refundCount / pattern.observationCount
        : 0,
    }));
}
