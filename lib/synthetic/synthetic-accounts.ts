import type { ChileanBillingLine } from "../rules/chilean-account.ts";
import type { ObservedCorpus, ObservedItemPattern } from "../rules/observed-corpus.ts";

export const DEFAULT_SYNTHETIC_ACCOUNT_COUNT = 12;
export const MIN_SYNTHETIC_ACCOUNT_COUNT = 8;
export const MAX_SYNTHETIC_ACCOUNT_COUNT = 24;

export type SyntheticProfileId =
  | "hospital_general"
  | "hospital_pediatric"
  | "operating_room"
  | "operating_room_anesthesia"
  | "hospitalized_medication"
  | "emergency"
  | "neonatal_critical"
  | "maternal"
  | "oncology"
  | "mixed_review";

export type SyntheticAccount = {
  profileId: SyntheticProfileId;
  label: string;
  episodeLabel: string;
  provider: string;
  lines: ChileanBillingLine[];
  patternKeys: string[];
  anchorDescription: string;
};

export type SyntheticAccountSuite = {
  seed: string;
  accounts: SyntheticAccount[];
  sourcePatternCount: number;
  sourceObservationCount: number;
  generatedPatternCount: number;
  generatedObservationCount: number;
};

type SyntheticProfile = {
  id: SyntheticProfileId;
  label: string;
  episodeLabel: string;
  section: string;
  provider: string;
  anchorDescription: string;
  anchorRange: [number, number];
  terms: string[];
};

const PROFILES: SyntheticProfile[] = [
  {
    id: "hospital_general",
    label: "Hospitalización general",
    episodeLabel: "Hospitalización general · cuenta sintética",
    section: "Hospitalización / Día cama",
    provider: "Prestador sintético hospitalario",
    anchorDescription: "Habitación y Día Cama",
    anchorRange: [180000, 720000],
    terms: ["hospital", "habitacion", "dia cama", "enfermeria", "material", "insumo"],
  },
  {
    id: "hospital_pediatric",
    label: "Hospitalización pediátrica",
    episodeLabel: "Hospitalización pediátrica · cuenta sintética",
    section: "Hospitalización / Pediatría",
    provider: "Prestador sintético pediátrico",
    anchorDescription: "Habitación Pediatría",
    anchorRange: [220000, 860000],
    terms: ["pediatr", "sala cuna", "niño", "infantil", "habitacion", "dia cama"],
  },
  {
    id: "operating_room",
    label: "Pabellón quirúrgico",
    episodeLabel: "Cirugía con pabellón · cuenta sintética",
    section: "Pabellón / Insumos quirúrgicos",
    provider: "Prestador sintético quirúrgico",
    anchorDescription: "Derecho de Pabellón",
    anchorRange: [720000, 2800000],
    terms: ["pabellon", "quirurg", "cirugia", "sutura", "campo", "drenaje", "cateter"],
  },
  {
    id: "operating_room_anesthesia",
    label: "Pabellón y anestesia",
    episodeLabel: "Cirugía con anestesia · cuenta sintética",
    section: "Pabellón / Anestesia y monitorización",
    provider: "Prestador sintético anestésico",
    anchorDescription: "Pabellón y anestesia",
    anchorRange: [980000, 3600000],
    terms: ["anest", "propofol", "rocuron", "sevofl", "monitor", "oxigen", "quirurg"],
  },
  {
    id: "hospitalized_medication",
    label: "Medicamentos hospitalizados",
    episodeLabel: "Hospitalización y medicamentos · cuenta sintética",
    section: "Medicamentos hospitalizados",
    provider: "Prestador sintético farmacológico",
    anchorDescription: "Medicamentos hospitalizados",
    anchorRange: [90000, 640000],
    terms: ["medicamento", "farmac", "farmacia", "suero", "antibiot", "analges", "inyect"],
  },
  {
    id: "emergency",
    label: "Urgencia y observación",
    episodeLabel: "Urgencia con observación · cuenta sintética",
    section: "Urgencia / Materiales y procedimientos",
    provider: "Prestador sintético de urgencia",
    anchorDescription: "Atención de urgencia",
    anchorRange: [65000, 460000],
    terms: ["urgencia", "emergencia", "observacion", "triage", "curacion", "toma de muestra"],
  },
  {
    id: "neonatal_critical",
    label: "Neonatal y cuidados críticos",
    episodeLabel: "Hospitalización neonatal UCI · cuenta sintética",
    section: "Hospitalización neonatal / UCI",
    provider: "Prestador sintético neonatal",
    anchorDescription: "Hospitalización neonatal UCI",
    anchorRange: [480000, 2400000],
    terms: ["neonat", "uci", "uti", "incubadora", "premat", "sala cuna", "critico"],
  },
  {
    id: "maternal",
    label: "Maternidad y parto",
    episodeLabel: "Parto y hospitalización materna · cuenta sintética",
    section: "Hospitalización materna / Parto",
    provider: "Prestador sintético materno",
    anchorDescription: "Parto y hospitalización materna",
    anchorRange: [320000, 1800000],
    terms: ["parto", "cesar", "mater", "obstetric", "ginecol", "puerper"],
  },
  {
    id: "oncology",
    label: "Hospitalización oncológica",
    episodeLabel: "Hospitalización oncológica · cuenta sintética",
    section: "Hospitalización oncológica",
    provider: "Prestador sintético oncológico",
    anchorDescription: "Hospitalización oncológica",
    anchorRange: [620000, 4200000],
    terms: ["oncolog", "quimio", "hepatic", "tumor", "cancer", "onco"],
  },
  {
    id: "mixed_review",
    label: "Cuenta mixta para revisión",
    episodeLabel: "Cuenta clínica mixta · cuenta sintética",
    section: "Cuenta clínica consolidada",
    provider: "Prestador sintético consolidado",
    anchorDescription: "Cuenta clínica consolidada",
    anchorRange: [260000, 2100000],
    terms: ["total", "cuenta", "servicio", "atencion", "prestacion"],
  },
];

const PROFILE_CYCLE: SyntheticProfileId[] = [
  "hospital_general",
  "hospital_pediatric",
  "operating_room",
  "operating_room_anesthesia",
  "hospitalized_medication",
  "emergency",
  "neonatal_critical",
  "maternal",
  "oncology",
  "mixed_review",
  "hospital_general",
  "operating_room",
];

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function seedNumber(seed: string) {
  let value = 2166136261;
  for (const character of seed) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function randomGenerator(seed: string) {
  let state = seedNumber(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integerBetween(random: () => number, min: number, max: number) {
  const lower = Math.round(Math.min(min, max));
  const upper = Math.round(Math.max(min, max));
  return lower + Math.floor(random() * (upper - lower + 1));
}

function shuffle<T>(values: T[], random: () => number) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function profileForPattern(pattern: ObservedItemPattern): SyntheticProfileId {
  const text = normalize(`${pattern.description} ${pattern.sections.join(" ")}`);
  if (/urgencia|emergencia/.test(text)) return "emergency";
  if (/neonat|uci|uti|incubadora|premat|sala cuna/.test(text)) return "neonatal_critical";
  if (/parto|cesar|mater|obstetric|ginecol|puerper/.test(text)) return "maternal";
  if (/oncolog|quimio|hepatic|tumor|cancer|onco/.test(text)) return "oncology";
  if (/anest|propofol|rocuron|sevofl|monitor|oxigen/.test(text)) return "operating_room_anesthesia";
  if (/pabellon|quirurg|cirugia|sutura|campo|drenaje/.test(text)) return "operating_room";
  if (/medicamento|farmac|farmacia|suero|antibiot|analges|inyect/.test(text)) return "hospitalized_medication";
  if (/pediatr|infantil|habitacion/.test(text)) return "hospital_pediatric";
  if (/cuenta|servicio|prestacion|atencion|total/.test(text)) return "mixed_review";
  return "hospital_general";
}

function profileById(id: SyntheticProfileId) {
  return PROFILES.find((profile) => profile.id === id) || PROFILES[0];
}

function pickValue(values: string[], random: () => number) {
  return values.length ? values[Math.floor(random() * values.length)] : undefined;
}

function providerFor(pattern: ObservedItemPattern, profile: SyntheticProfile, random: () => number) {
  const observed = pickValue(pattern.providers, random);
  return observed ? `Simulado · ${observed}` : profile.provider;
}

function amountFor(pattern: ObservedItemPattern, random: () => number) {
  const min = Number.isFinite(pattern.totalMin) ? Math.max(0, pattern.totalMin as number) : 500;
  const max = Number.isFinite(pattern.totalMax) ? Math.max(min, pattern.totalMax as number) : Math.max(min, 65000);
  let amount = integerBetween(random, min, max);
  const observedCount = Math.max(1, pattern.observationCount);
  if (pattern.zeroValueCount > 0 && random() < Math.min(0.12, pattern.zeroValueCount / observedCount)) amount = 0;
  if (pattern.refundCount > 0 && random() < Math.min(0.08, pattern.refundCount / observedCount)) amount = -Math.max(1, amount);
  return amount;
}

function lineFromPattern(
  pattern: ObservedItemPattern,
  profile: SyntheticProfile,
  accountIndex: number,
  lineIndex: number,
  random: () => number,
): ChileanBillingLine {
  const descriptions = [pattern.description, ...pattern.aliases];
  const description = descriptions[lineIndex % descriptions.length] || pattern.description;
  const amount = amountFor(pattern, random);
  const unitMin = pattern.unitPriceMin == null ? undefined : Math.max(0, pattern.unitPriceMin);
  const unitMax = pattern.unitPriceMax == null ? unitMin : Math.max(unitMin || 0, pattern.unitPriceMax);
  const unitAmount = unitMin == null ? undefined : integerBetween(random, unitMin, unitMax || unitMin);
  const quantity = unitAmount && unitAmount > 0 ? Math.max(1, Math.min(8, Math.round(Math.abs(amount) / unitAmount) || 1)) : integerBetween(random, 1, 3);
  const observedSection = pickValue(pattern.sections, random);
  return {
    id: `synthetic-line-${accountIndex + 1}-${lineIndex + 1}`,
    description,
    amount,
    page: 1 + Math.floor(lineIndex / 22),
    date: `2026-01-${String(3 + (accountIndex % 24)).padStart(2, "0")}`,
    code: pickValue(pattern.codes, random),
    fonasaCode: pickValue(pattern.fonasaCodes, random),
    section: profile.section,
    subgroup: observedSection || "Patrón observado",
    providerId: providerFor(pattern, profile, random),
    quantity,
    unitAmount,
    confidence: 0.98,
    sourceText: `${description} · ${observedSection || profile.section}`,
  };
}

function anchorLine(profile: SyntheticProfile, accountIndex: number, random: () => number): ChileanBillingLine {
  const [min, max] = profile.anchorRange;
  return {
    id: `synthetic-anchor-${accountIndex + 1}`,
    description: profile.anchorDescription,
    amount: integerBetween(random, min, max),
    page: 1,
    date: `2026-01-${String(3 + (accountIndex % 24)).padStart(2, "0")}`,
    section: profile.section,
    subgroup: "Ancla de contexto sintético",
    providerId: profile.provider,
    quantity: 1,
    confidence: 1,
    sourceText: `${profile.anchorDescription} · cuenta sintética`,
  };
}

/**
 * Creates a reproducible, clearly synthetic test suite from the desidentified
 * corpus. It expands each observed pattern according to its historical
 * observationCount, then distributes those lines across context-compatible
 * account profiles. Synthetic lines never become corpus contributions.
 */
export function generateSyntheticAccountSuite(options: {
  corpus: ObservedCorpus;
  count?: number;
  seed?: string;
}): SyntheticAccountSuite {
  const count = Math.max(
    MIN_SYNTHETIC_ACCOUNT_COUNT,
    Math.min(MAX_SYNTHETIC_ACCOUNT_COUNT, Math.round(options.count || DEFAULT_SYNTHETIC_ACCOUNT_COUNT)),
  );
  const seed = options.seed?.trim() || "revisatucuenta-synthetic-v1";
  const random = randomGenerator(seed);
  const profiles = Array.from({ length: count }, (_, index) => profileById(PROFILE_CYCLE[index % PROFILE_CYCLE.length]));
  const accounts: SyntheticAccount[] = profiles.map((profile, index) => ({
    profileId: profile.id,
    label: `Cuenta sintética ${String(index + 1).padStart(2, "0")} · ${profile.label}`,
    episodeLabel: profile.episodeLabel,
    provider: profile.provider,
    lines: [anchorLine(profile, index, random)],
    patternKeys: [],
    anchorDescription: profile.anchorDescription,
  }));

  const accountIndexesByProfile = new Map<SyntheticProfileId, number[]>();
  accounts.forEach((account, index) => {
    const indexes = accountIndexesByProfile.get(account.profileId) || [];
    indexes.push(index);
    accountIndexesByProfile.set(account.profileId, indexes);
  });
  const cursors = new Map<SyntheticProfileId, number>();
  const occurrences = shuffle(
    options.corpus.patterns.flatMap((pattern) =>
      Array.from({ length: Math.max(1, pattern.observationCount) }, (_, occurrence) => ({ pattern, occurrence }))),
    random,
  );

  for (const occurrence of occurrences) {
    const intendedProfile = profileForPattern(occurrence.pattern);
    const compatible = accountIndexesByProfile.get(intendedProfile)
      || accountIndexesByProfile.get("mixed_review")
      || accountIndexesByProfile.get("hospital_general")
      || [0];
    const cursor = cursors.get(intendedProfile) || 0;
    const accountIndex = compatible[cursor % compatible.length];
    cursors.set(intendedProfile, cursor + 1);
    const account = accounts[accountIndex];
    const profile = profileById(account.profileId);
    const line = lineFromPattern(occurrence.pattern, profile, accountIndex, account.lines.length, random);
    account.lines.push(line);
    if (!account.patternKeys.includes(occurrence.pattern.normalizedDescription)) {
      account.patternKeys.push(occurrence.pattern.normalizedDescription);
    }
  }

  for (const account of accounts) {
    account.lines = account.lines.map((line, index) => ({
      ...line,
      page: 1 + Math.floor(index / 22),
    }));
  }

  return {
    seed,
    accounts,
    sourcePatternCount: options.corpus.patternCount,
    sourceObservationCount: options.corpus.observationCount,
    generatedPatternCount: new Set(accounts.flatMap((account) => account.patternKeys)).size,
    generatedObservationCount: occurrences.length,
  };
}

export function syntheticProfileDefinitions() {
  return PROFILES.map((profile) => ({ ...profile, terms: [...profile.terms] }));
}
