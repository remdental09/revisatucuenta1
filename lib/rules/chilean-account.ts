import {
  findObservedEquivalents,
  OBSERVED_CHILEAN_ACCOUNT_CORPUS,
  type ObservedEquivalent,
} from "./observed-corpus.ts";

export type BundleFamily =
  | "operating_room"
  | "hospital_stay"
  | "procedure"
  | "professional_fees"
  | "unassigned";

export type KnowledgeAuthority =
  | "technical_standard"
  | "contract"
  | "regulator_decision"
  | "clinical_review"
  | "observed_billing_pattern";

export type KnowledgeStatus = "confirmed" | "provisional" | "contradicted";

export type ChileanBillingLine = {
  id: string;
  description: string;
  amount: number;
  page: number;
  code?: string;
  fonasaCode?: string;
  section?: string;
  subgroup?: string;
  date?: string;
  documentId?: string;
  providerId?: string;
  professionalId?: string;
  professionalRole?: string;
  quantity?: number;
  unitAmount?: number;
  factor?: number;
};

export type InclusionKnowledge = {
  id: string;
  label: string;
  terms: string[];
  bundle: Exclude<BundleFamily, "unassigned" | "professional_fees">;
  probability: number;
  authority: KnowledgeAuthority;
  status: KnowledgeStatus;
  scope: "general_chile" | "fonasa_mle" | "contract_specific" | "provider_observation";
  sourceReference: string;
  rationale: string;
};

export type InclusionCandidate = {
  bundle: BundleFamily;
  probability: number;
  knowledgeIds: string[];
  reasons: string[];
  missingEvidence: string[];
};

export type AccountAnomaly = {
  type:
    | "exact_duplicate_candidate"
    | "zero_value_inclusion_marker"
    | "opaque_adjustment"
    | "multi_entity_episode"
    | "simultaneous_procedure_factor";
  severity: "informational" | "review" | "high";
  lineIds: string[];
  explanation: string;
};

export type ClinicalAccountAnalysis = {
  version: string;
  lineAssessments: Array<{
    line: ChileanBillingLine;
    normalizedSection: string;
    candidates: InclusionCandidate[];
    observedEquivalents: ObservedEquivalent[];
  }>;
  anomalies: AccountAnomaly[];
  providerIds: string[];
  observedCorpus: {
    version: string;
    caseCount: number;
    observationCount: number;
    patternCount: number;
    learningBoundary: string;
  };
  limitations: string[];
};

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const unique = <T,>(values: T[]) => Array.from(new Set(values));
const clamp = (value: number) => Math.max(0.05, Math.min(0.98, value));

export const CHILEAN_SECTION_ALIASES: Record<string, BundleFamily> = {
  "derecho pabellon": "operating_room",
  pabellon: "operating_room",
  "pabellon transitorio": "operating_room",
  "farmacia en pabellon": "operating_room",
  "insumos pabellon": "operating_room",
  "hospitalizacion transitoria": "hospital_stay",
  "hospitalizac transitoria": "hospital_stay",
  "dia cama": "hospital_stay",
  "dia cama individual": "hospital_stay",
  "farmacia hospitalizacion": "hospital_stay",
  "materiales clinicos": "unassigned",
  farmacia: "unassigned",
  "honorario quirurgico": "professional_fees",
};

/**
 * Versioned, deliberately non-exhaustive knowledge. A probability is an
 * inclusion hypothesis, never a legal conclusion. Contract- or decision-based
 * entries can be added as claims are resolved, without rewriting old evidence.
 */
export const DEFAULT_CHILEAN_INCLUSION_KNOWLEDGE: InclusionKnowledge[] = [
  {
    id: "CL-PAB-GENERAL-001",
    label: "Insumos generales usados en pabellón",
    terms: [
      "jeringa",
      "aguja",
      "hoja bisturi",
      "bata quirur",
      "delantal esteril",
      "sabana",
      "gasa",
      "torula",
      "tela micropore",
      "sonda aspiracion",
      "tubo aspiracion",
      "tubo endotraqueal",
      "equipo fleboclisis",
      "contador d aguja",
      "lapiz marcador quirurgico",
      "receptal",
    ],
    bundle: "operating_room",
    probability: 0.78,
    authority: "technical_standard",
    status: "provisional",
    scope: "fonasa_mle",
    sourceReference: "Resolución Exenta N°277/2011, punto 26",
    rationale:
      "La norma MLE describe categorías incluidas, pero no enumera cada marca o material y no se traslada automáticamente a todo convenio Isapre.",
  },
  {
    id: "CL-PAB-ANEST-001",
    label: "Medicamentos de anestesia y uso perioperatorio",
    terms: [
      "propofol",
      "rocuronio",
      "remifentanilo",
      "sevoflurano",
      "succinil colina",
      "bupivacaina",
      "lidocaina",
      "sugammadex",
      "atropina",
      "efedrina",
      "metadona",
    ],
    bundle: "operating_room",
    probability: 0.82,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuentas observadas: apendicitis INDISA y turbinectomía Clínica Alemana",
    rationale:
      "Su uso es coherente con anestesia o pabellón; la inclusión económica depende del instrumento contractual aplicable.",
  },
  {
    id: "CL-PAB-ANEST-EQUIP-001",
    label: "Consumibles funcionales de anestesia y control perioperatorio",
    terms: [
      "kit anestesia",
      "cobertor underbody",
      "alargador de tubo hme",
    ],
    bundle: "operating_room",
    probability: 0.62,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta D1482290 de turbinectomía y rinoplastia; revisión funcional perioperatoria",
    rationale:
      "Es un consumible funcionalmente unido a anestesia o al control perioperatorio. Puede ser separable, pero requiere registro de uso y la regla del convenio que autoriza cobrarlo fuera del derecho de pabellón u honorario anestésico.",
  },
  {
    id: "CL-PAB-ELECTROSURG-001",
    label: "Componentes del sistema de electrocirugía",
    terms: [
      "alargador electrodo electrobist",
      "alargador electrod electrobist",
      "micropunta colorado",
      "limpia electrodo",
      "placa valleylab",
      "lapiz electrobisturi",
    ],
    bundle: "operating_room",
    probability: 0.7,
    authority: "technical_standard",
    status: "provisional",
    scope: "fonasa_mle",
    sourceReference: "Normativa MLE sobre derecho de pabellón y cuenta D1482290",
    rationale:
      "Los componentes forman un sistema funcional de electrocirugía usado en pabellón. Debe distinguirse el uso del equipo, los consumibles generales y los insumos especiales que el convenio permita cobrar separadamente.",
  },
  {
    id: "CL-PAB-OCULAR-001",
    label: "Protección ocular asociada a anestesia",
    terms: ["duratears", "unguento oftalmico"],
    bundle: "operating_room",
    probability: 0.5,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta D1482290 de turbinectomía y rinoplastia",
    rationale:
      "El producto es compatible con protección ocular perioperatoria. Debe acreditarse su administración y aclararse si integra la anestesia o si el convenio permite su cobro separado.",
  },
  {
    id: "CL-PAB-MONITOR-001",
    label: "Sensor de monitorización anestésica",
    terms: ["sensor sedline", "masac4248 sensor", "rd masac4248"],
    bundle: "operating_room",
    probability: 0.46,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta D1482290 de turbinectomía y rinoplastia",
    rationale:
      "Está vinculado a monitorización anestésica, pero puede ser un sensor especial separable. Requiere registro anestésico, identificación del monitor y regla contractual de cobro.",
  },
  {
    id: "CL-PAB-SPECIAL-001",
    label: "Material quirúrgico específico o implantable",
    terms: [
      "ferula nasal",
      "neurosorb",
      "sensor sedline",
      "monocryl",
      "ethilon",
      "prolene",
      "pds polidio",
      "surgitie",
      "vicryl",
    ],
    bundle: "operating_room",
    probability: 0.46,
    authority: "observed_billing_pattern",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuentas clínicas aportadas al proyecto",
    rationale:
      "Está asociado al acto quirúrgico, pero puede ser un insumo especial legítimamente separable; requiere convenio y respaldo de uso.",
  },
  {
    id: "CL-STAY-NURSING-001",
    label: "Procedimientos y materiales habituales de enfermería",
    terms: [
      "instalacion via venosa",
      "via venosa",
      "fleboclisis",
      "cateter i v",
      "suero fisiologico",
      "ringer lactato",
      "humidificador desechable",
    ],
    bundle: "hospital_stay",
    probability: 0.72,
    authority: "technical_standard",
    status: "provisional",
    scope: "fonasa_mle",
    sourceReference: "Resolución Exenta N°277/2011, reglas de día cama integral",
    rationale:
      "Son compatibles con cuidados habituales de enfermería, pero la conclusión económica exige identificar el tipo de estancia y el contrato.",
  },
  {
    id: "CL-PERI-THROMBO-001",
    label: "Elementos de prevención tromboembólica perioperatoria",
    terms: ["medias antiembol", "manga piernera antienb", "manga piernera antiemb"],
    bundle: "hospital_stay",
    probability: 0.46,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta D1482290 de turbinectomía y rinoplastia",
    rationale:
      "Se vincula a prevención tromboembólica perioperatoria. Debe acreditarse el uso de cada dispositivo, distinguir sus funciones y aclarar si corresponde a pabellón, hospitalización o cobro separado.",
  },
  {
    id: "CL-STAY-AMENITY-001",
    label: "Artículos de hospitalización o comodidad de inclusión incierta",
    terms: [
      "termometro",
      "esponja",
      "set de aseo",
      "set aseo",
      "calzon clinico",
      "delantal paciente",
      "medias antiembol",
      "lubricante ocular",
      "removedor de adhesivo",
      "manga piernera antienb",
      "manga piernera antiemb",
    ],
    bundle: "hospital_stay",
    probability: 0.38,
    authority: "observed_billing_pattern",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta INDISA apendicitis y antecedentes de reclamo",
    rationale:
      "No existe una lista universal exhaustiva. Debe aprenderse de contratos, resoluciones y decisiones regulatorias específicas.",
  },
];

function inferSectionFamily(section: string): BundleFamily {
  const normalized = normalize(section);
  const exact = CHILEAN_SECTION_ALIASES[normalized];
  if (exact) return exact;
  const alias = Object.entries(CHILEAN_SECTION_ALIASES).find(([term]) =>
    normalized.includes(term),
  );
  return alias?.[1] ?? "unassigned";
}

function scoreLine(
  line: ChileanBillingLine,
  lines: ChileanBillingLine[],
  knowledge: InclusionKnowledge[],
): InclusionCandidate[] {
  const description = normalize(line.description);
  const section = normalize(`${line.section ?? ""} ${line.subgroup ?? ""}`);
  const sectionFamily = inferSectionFamily(section);
  const evidence = knowledge.filter(
    (entry) =>
      entry.status !== "contradicted" &&
      entry.terms.some((term) => description.includes(normalize(term))),
  );
  const linkedFamilies = new Set(
    lines
      .filter(
        (candidate) =>
          candidate.id !== line.id &&
          Boolean(line.documentId) &&
          candidate.documentId === line.documentId &&
          candidate.date === line.date,
      )
      .map((candidate) =>
        inferSectionFamily(`${candidate.section ?? ""} ${candidate.description}`),
      )
      .filter((family) => family !== "unassigned"),
  );
  // La sección entrega contexto, pero no convierte por sí sola una prestación
  // principal (p. ej. una colecistectomía o un derecho de pabellón) en un
  // componente posiblemente incluido. Solo el conocimiento específico sobre
  // la glosa abre una hipótesis de inclusión.
  const bundles = unique(evidence.map((entry) => entry.bundle));

  return bundles.map((bundle) => {
    const matched = evidence.filter((entry) => entry.bundle === bundle);
    let probability = matched.length
      ? Math.max(...matched.map((entry) => entry.probability))
      : 0.45;
    const reasons = matched.map((entry) => entry.rationale);
    if (sectionFamily === bundle) {
      probability += 0.1;
      reasons.push(`La sección chilena “${line.section ?? line.subgroup}” apunta al mismo contexto.`);
    }
    if (linkedFamilies.has(bundle)) {
      probability += 0.08;
      reasons.push("Comparte fecha y número documental con una prestación principal del mismo contexto.");
    }
    const needsContract = matched.some(
      (entry) => entry.scope !== "general_chile" && entry.status !== "confirmed",
    );
    return {
      bundle,
      probability: clamp(probability),
      knowledgeIds: matched.map((entry) => entry.id),
      reasons: unique(reasons),
      missingEvidence: needsContract
        ? ["Contrato, convenio o resolución aplicable al episodio"]
        : [],
    };
  });
}

function duplicateKey(line: ChileanBillingLine) {
  return [
    normalize(line.code),
    normalize(line.description),
    normalize(line.date),
    normalize(line.documentId),
    line.quantity ?? "",
    line.unitAmount ?? "",
    line.amount,
    normalize(line.providerId),
  ].join("|");
}

function detectAnomalies(lines: ChileanBillingLine[]): AccountAnomaly[] {
  const anomalies: AccountAnomaly[] = [];
  const grouped = new Map<string, ChileanBillingLine[]>();
  for (const line of lines) {
    const key = duplicateKey(line);
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
    if (line.amount === 0) {
      anomalies.push({
        type: "zero_value_inclusion_marker",
        severity: "informational",
        lineIds: [line.id],
        explanation:
          "La línea registra uso con valor cero. Debe conservarse como posible evidencia de que la clínica trató el artículo como incluido.",
      });
    }
    if (
      line.amount > 0 &&
      /\b(ajuste|varios|diferencia|cargo adicional)\b/.test(
        normalize(`${line.section ?? ""} ${line.description}`),
      )
    ) {
      anomalies.push({
        type: "opaque_adjustment",
        severity: "high",
        lineIds: [line.id],
        explanation:
          "Cargo positivo con glosa administrativa genérica y sin ancla clínica suficiente; requiere desglose y fundamento.",
      });
    }
    if (line.factor != null && line.factor > 0 && line.factor < 1) {
      anomalies.push({
        type: "simultaneous_procedure_factor",
        severity: "informational",
        lineIds: [line.id],
        explanation:
          "El factor porcentual puede corresponder a cirugía simultánea, procedimiento secundario o rol profesional; no es duplicidad por sí solo.",
      });
    }
  }
  for (const matches of grouped.values()) {
    if (matches.length < 2) continue;
    const roleVariation =
      unique(matches.map((line) => line.professionalId).filter(Boolean)).length > 1 ||
      unique(matches.map((line) => line.professionalRole).filter(Boolean)).length > 1 ||
      unique(matches.map((line) => line.factor).filter((value) => value != null)).length > 1;
    if (!roleVariation) {
      anomalies.push({
        type: "exact_duplicate_candidate",
        severity: "high",
        lineIds: matches.map((line) => line.id),
        explanation:
          "Coinciden código, glosa, fecha, documento, cantidad, precio y emisor. Debe contrastarse con el registro clínico de administración o consumo.",
      });
    }
  }
  const providers = unique(lines.map((line) => line.providerId).filter(Boolean));
  if (providers.length > 1) {
    anomalies.push({
      type: "multi_entity_episode",
      severity: "informational",
      lineIds: lines.map((line) => line.id),
      explanation:
        "El episodio fue facturado por varias razones sociales. Debe analizarse como un solo evento, preservando el emisor de cada línea.",
    });
  }
  return anomalies;
}

export function analyzeClinicalAccount(
  lines: ChileanBillingLine[],
  knowledge: InclusionKnowledge[] = DEFAULT_CHILEAN_INCLUSION_KNOWLEDGE,
): ClinicalAccountAnalysis {
  return {
    version: "cl-account-v1",
    lineAssessments: lines.map((line) => ({
      line,
      normalizedSection: normalize(`${line.section ?? ""} ${line.subgroup ?? ""}`),
      candidates: scoreLine(line, lines, knowledge),
      observedEquivalents: findObservedEquivalents(line),
    })),
    anomalies: detectAnomalies(lines),
    providerIds: unique(lines.map((line) => line.providerId).filter(Boolean)),
    observedCorpus: {
      version: OBSERVED_CHILEAN_ACCOUNT_CORPUS.version,
      caseCount: OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount,
      observationCount: OBSERVED_CHILEAN_ACCOUNT_CORPUS.observationCount,
      patternCount: OBSERVED_CHILEAN_ACCOUNT_CORPUS.patternCount,
      learningBoundary: OBSERVED_CHILEAN_ACCOUNT_CORPUS.learningBoundary,
    },
    limitations: [
      "La probabilidad expresa pertenencia plausible a una prestación principal; no prueba por sí sola un cobro improcedente.",
      "No existe una lista técnica universal y exhaustiva para cada material, marca o presentación.",
      "La conclusión económica requiere el contrato, convenio, arancel o decisión regulatoria aplicable.",
      "La fase de cuenta clínica debe completarse antes de incorporar PAM, bonificación, copago o rechazo de la Isapre.",
    ],
  };
}

export type AdjudicatedLearning = {
  id: string;
  label: string;
  terms: string[];
  bundle: Exclude<BundleFamily, "unassigned" | "professional_fees">;
  outcome: "included" | "separate_allowed" | "inconclusive";
  authority: Exclude<KnowledgeAuthority, "observed_billing_pattern">;
  sourceReference: string;
  scope: InclusionKnowledge["scope"];
};

export function knowledgeFromAdjudication(
  learning: AdjudicatedLearning,
): InclusionKnowledge {
  const probability =
    learning.outcome === "included"
      ? 0.96
      : learning.outcome === "separate_allowed"
        ? 0.08
        : 0.5;
  return {
    id: learning.id,
    label: learning.label,
    terms: learning.terms,
    bundle: learning.bundle,
    probability,
    authority: learning.authority,
    status: learning.outcome === "inconclusive" ? "provisional" : "confirmed",
    scope: learning.scope,
    sourceReference: learning.sourceReference,
    rationale:
      learning.outcome === "included"
        ? "Una fuente revisada determinó que el componente estaba incluido en la prestación principal."
        : learning.outcome === "separate_allowed"
          ? "Una fuente revisada admitió el cobro separado para el alcance indicado."
          : "El antecedente no permitió resolver la inclusión; se conserva como evidencia sin elevar certeza.",
  };
}
