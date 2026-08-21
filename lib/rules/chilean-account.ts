import {
  findFunctionalEquivalenceAlerts,
  findObservedEquivalents,
  OBSERVED_CHILEAN_ACCOUNT_CORPUS,
  type FunctionalEquivalenceAlert,
  type ObservedEquivalent,
} from "./observed-corpus.ts";
import {
  UNIVERSAL_CLAIM_FRAMEWORK,
  EQUALITY_PROJECTION_FRAMEWORK,
  FULL_OPERATING_ROOM_FRAMEWORK,
  type EqualityProjectionFramework,
  type ClaimFramework,
  type OperatingRoomFramework,
} from "../claims/legal-basis.ts";

export type BundleFamily =
  | "operating_room"
  | "hospital_stay"
  | "hospitalized_medication"
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
  precedentIds: string[];
  precedentSupport: number;
  reasons: string[];
  missingEvidence: string[];
};

export type PrecedentComparison = {
  precedentId: string;
  label: string;
  sourceReference: string;
  outcomeBundle: BundleFamily;
  outcome: "included" | "excluded";
  outcomeLabel: string;
  comparability: number;
  status: "strong_comparator" | "partial_comparator" | "not_comparable";
  matchedFactors: string[];
  missingEvidence: string[];
  distinctionFactors: string[];
  explanation: string;
};

export type ReasoningFinding = {
  id:
    | "SUP-CODING-ERROR-001"
    | "SUP-RESTRICTIVE-EXCLUSION-001"
    | "SUP-INTEGRAL-CHARGE-001"
    | "SUP-INFORMATION-PAYMENT-001"
    | "SUP-BUDGET-CODE-001"
    | "SUP-PROCEDURAL-CHAIN-001";
  title: string;
  status: "relevant" | "needs_evidence" | "not_triggered";
  explanation: string;
  action: string;
  matchedLineIds: string[];
  evidenceToRequest: string[];
  sourceReferences: string[];
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
  claimFramework: ClaimFramework;
  equalityProjection: EqualityProjectionFramework;
  operatingRoomFramework: OperatingRoomFramework;
  lineAssessments: Array<{
    line: ChileanBillingLine;
    normalizedSection: string;
    candidates: InclusionCandidate[];
    observedEquivalents: ObservedEquivalent[];
    functionalEquivalenceAlerts: FunctionalEquivalenceAlert[];
    precedentComparisons: PrecedentComparison[];
  }>;
  functionalEquivalenceAlerts: FunctionalEquivalenceAlert[];
  anomalies: AccountAnomaly[];
  reasoningFindings: ReasoningFinding[];
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
  "medicamentos hospitalizados": "hospitalized_medication",
  "medicamentos hospitalizacion": "hospitalized_medication",
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
    id: "CL-PAB-CIRCULAR43-FULL-001",
    label: "Alcance integral del Derecho de Pabellón",
    terms: [
      "aspiracion", "bomba aspiracion", "receptal", "oxigeno", "aire comprimido",
      "kit anestesia", "tubo endotraqueal", "entubacion", "monitor", "sensor", "electrodo",
      "oxisensor", "resucitador", "conexion", "conector", "electrobisturi", "lapiz electrobisturi",
      "600510244 alargador",
      "placa valleylab", "micropunta", "laser quirurgico", "ventilacion mecanica", "endoscopia",
      "laparoscopia", "microscopio", "hoja bisturi", "hojas bisturi", "cateter", "cat i v",
      "branula", "intrafix", "adaptador suero", "tubo ext c llave", "delantal esteril",
      "bata quirur", "alargador de tubo hme", "humidificador",
      "bata quirurgica", "ropa esteril", "jeringa", "aguja", "fleboclisis", "bajada", "tapa",
      "tapon", "llave 3 pasos", "guante", "drenaje", "canula", "sonda", "pano esteril",
      "campo quirurgico", "gasa", "algodon", "torula", "aposito", "tela adhesiva", "micropore",
      "tegaderm", "antiseptico", "desinfectante", "povidona", "clorhexidina", "formalina",
      "allevyn", "hisopo esteril", "lapiz marcador", "mascarilla multivent", "tubo endot",
      "jabon quirurgico", "esponja con jabon", "escobilla", "sutura", "sutupack", "vicryl", "monocryl",
      "prolene", "ethilon", "pds", "surgitie", "propofol", "rocuronio", "remifentanilo",
      "sevoflurano", "sugammadex", "bupivacaina", "lidocaina", "medias antiembol",
      "anestesico", "oxido nitroso", "aire medicinal",
      "manga piernera", "compresor neumatico", "calzon clinico", "cobertor underbody",
    ],
    bundle: "operating_room",
    probability: 0.84,
    authority: "technical_standard",
    status: "provisional",
    scope: "fonasa_mle",
    sourceReference:
      "Circular N.º 43 y Compendio de Procedimientos, Apéndice del Anexo N.º 4, Derecho de Pabellón, pp. 113-116",
    rationale:
      "Con pabellón confirmado, la categoría está expresamente comprendida en la definición amplia: equipos y no fungibles, insumos desechables o recuperables, fungibles generales, gases o anestésicos. El cobro separado requiere una diferencia objetiva y fundamento contractual verificable.",
  },
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
    id: "CL-STAY-NURSING-IV-002",
    label: "Circuito intravenoso y cuidado local de enfermería",
    terms: [
      "intravena jelco",
      "jelco teflon",
      "mariposa intrav",
      "aposito quir",
      "aposito tegaderm",
      "prot cutaneo",
      "skin remove",
      "toallita c alcohol",
      "toallita alcohol esteril",
      "tapa clave",
      "llave 3 pasos",
      "bajada standar",
      "jeringa",
      "aguja",
      "liga elastica para puncion",
      "jeringa gases",
      "kit hemocultivo",
    ],
    bundle: "hospital_stay",
    probability: 0.62,
    authority: "clinical_review",
    status: "provisional",
    scope: "contract_specific",
    sourceReference: "Cuenta Rafaella: hospitalización pediátrica sin pabellón",
    rationale:
      "En una hospitalización pediátrica sin ancla de pabellón, el conjunto forma un circuito coherente de instalación, mantención, administración intravenosa y toma de muestras. La inclusión económica todavía exige el contrato, convenio o norma técnica aplicable.",
  },
  {
    id: "CL-MED-HOSP-OCULAR-001",
    label: "Medicamento utilizado durante hospitalización",
    terms: ["lubricante ocular", "duratears", "unguento oftalmico"],
    bundle: "hospitalized_medication",
    probability: 0.84,
    authority: "regulator_decision",
    status: "provisional",
    scope: "contract_specific",
    sourceReference: "Tribunal Arbitral, Rol 4063244-2025, considerando 7: Lubricante Ocular",
    rationale:
      "La sentencia lo ubicó en el ítem Medicamentos Hospitalizados para el episodio resuelto. En una cuenta nueva debe verificarse identidad, administración efectiva y contrato aplicable.",
  },
  {
    id: "CL-PAB-ARBITRAL-4063244-001",
    label: "Elementos clasificados en Derecho de Pabellón por antecedente arbitral",
    terms: [
      "medias antiembolicas",
      "medias antiembolismo",
      "calzon clinico",
      "esponja con jabon neutro",
      "esponja jabon neutro",
      "delantal esteril",
      "mangas para compresor neumatico",
      "manga compresor neumatico",
    ],
    bundle: "operating_room",
    probability: 0.9,
    authority: "regulator_decision",
    status: "provisional",
    scope: "contract_specific",
    sourceReference: "Tribunal Arbitral, Rol 4063244-2025, considerando 7: Derecho de Pabellón",
    rationale:
      "La sentencia los agrupó bajo Derecho de Pabellón en el episodio resuelto. La proyección exige verificar pabellón real, función del elemento y contrato aplicable.",
  },
  {
    id: "CL-PERI-THROMBO-001",
    label: "Elementos de prevención tromboembólica perioperatoria",
    terms: ["medias antiembol", "manga piernera antienb", "manga piernera antiemb"],
    bundle: "operating_room",
    probability: 0.46,
    authority: "clinical_review",
    status: "provisional",
    scope: "provider_observation",
    sourceReference: "Cuenta D1482290 de turbinectomía y rinoplastia",
    rationale:
      "La sentencia arbitral ubicó estos elementos en Derecho de Pabellón para el episodio resuelto. La función perioperatoria es compatible, pero debe acreditarse el uso y la equivalencia del nuevo contexto.",
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

export type PrecedentRule = {
  id: string;
  label: string;
  sourceReference: string;
  terms: string[];
  codes: string[];
  outcomeBundle: BundleFamily;
  outcome: "included" | "excluded";
  outcomeLabel: string;
  decisionOutcome: string;
  caseContext: string;
};

/**
 * Antecedentes adjudicados que pueden compararse con nuevas cuentas. El
 * alcance queda expresamente limitado al caso resuelto: el motor los usa
 * para construir una presunción argumental y pedir consistencia, no para
 * declarar cobertura por sí solo.
 */
export const CHILEAN_PRECEDENT_RULES: PrecedentRule[] = [
  {
    id: "SUP-ARB-4063244-2025-DIACAMA-001",
    label: "Día cama: insumos de enfermería y hospitalización",
    sourceReference:
      "Tribunal Arbitral de la Superintendencia de Salud, Rol 4063244-2025, considerando 7, sentencia de 15-04-2026",
    terms: [
      "removedor de adhesivos",
      "removedor de adhesivo",
      "removedor adhesivos",
      "delantal paciente azul",
      "delantal paciente",
      "termometro digital",
      "termometro",
      "instalacion de via venosa",
      "instalacion via venosa",
      "fleboclisis",
    ],
    codes: ["63100133", "600510115", "2601118", "2601119"],
    outcomeBundle: "hospital_stay",
    outcome: "included",
    outcomeLabel: "Día Cama",
    decisionOutcome:
      "En el episodio resuelto, Removedor de Adhesivos, Delantal Paciente Azul, Termómetro Digital, Instalación de Vía Venosa y Fleboclisis fueron sumados al Día Cama y bonificados bajo ese ítem.",
    caseContext:
      "Reclamo por cargos de insumos durante atención de urgencia y hospitalización, con discusión de homologación y cobertura contractual.",
  },
  {
    id: "SUP-ARB-4063244-2025-MED-HOSP-001",
    label: "Lubricante ocular: criterio arbitral de medicamento hospitalizado",
    sourceReference:
      "Tribunal Arbitral de la Superintendencia de Salud, Rol 4063244-2025, considerando 7, sentencia de 15-04-2026",
    terms: ["lubricante ocular", "duratears", "unguento oftalmico"],
    codes: [],
    outcomeBundle: "hospitalized_medication",
    outcome: "included",
    outcomeLabel: "Medicamentos hospitalizados",
    decisionOutcome:
      "En el episodio resuelto, el Lubricante Ocular fue sumado al ítem Medicamentos Hospitalizados y bonificado conforme a ese rubro.",
    caseContext:
      "Clasificación expresa de un medicamento utilizado durante un episodio hospitalario; exige validar administración y condiciones contractuales del caso nuevo.",
  },
  {
    id: "SUP-ARB-4063244-2025-PAB-001",
    label: "Pabellón: elementos de uso quirúrgico",
    sourceReference:
      "Tribunal Arbitral de la Superintendencia de Salud, Rol 4063244-2025, considerando 7, sentencia de 15-04-2026",
    terms: [
      "medias antiembolicas",
      "medias antiembolismo",
      "calzon clinico",
      "esponja con jabon neutro",
      "esponja jabon neutro",
      "delantal esteril",
      "mangas para compresor neumatico",
      "manga compresor neumatico",
      "manga piernera antiemb",
    ],
    codes: [],
    outcomeBundle: "operating_room",
    outcome: "included",
    outcomeLabel: "Derecho de Pabellón",
    decisionOutcome:
      "En el episodio resuelto, Medias Antiembólicas, Calzón Clínico, Esponja con Jabón Neutro, Delantal Estéril y Mangas para Compresor Neumático fueron sumados al Derecho de Pabellón y bonificados bajo ese ítem.",
    caseContext:
      "Clasificación expresa de elementos asociados al recinto quirúrgico; requiere confirmar que el episodio nuevo tenga pabellón y función equivalente.",
  },
  {
    id: "SUP-ARB-4063244-2025-EXCL-001",
    label: "Set de aseo personal adulto: exclusión en el caso resuelto",
    sourceReference:
      "Tribunal Arbitral de la Superintendencia de Salud, Rol 4063244-2025, considerando 7, sentencia de 15-04-2026",
    terms: ["set de aseo personal adulto", "set aseo personal adulto"],
    codes: [],
    outcomeBundle: "unassigned",
    outcome: "excluded",
    outcomeLabel: "Sin cobertura en el caso resuelto",
    decisionOutcome:
      "En el episodio resuelto, el Set de Aseo Personal Adulto permaneció sin cobertura; esa conclusión no autoriza trasladar la exclusión a otro plan o episodio sin comparar sus circunstancias.",
    caseContext:
      "La sentencia distinguió artículos de uso personal de los insumos incorporados a Día Cama o Derecho de Pabellón.",
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

const HOSPITAL_STAY_ANCHORS = [
  "dia cama",
  "hospitalizacion",
  "hospitalizado",
  "habitacion",
  "pediatria",
  "sala cuna",
  "nursery",
  "uti",
  "uci",
  "atencion cerrada",
];

const OPERATING_ROOM_ANCHORS = [
  "derecho de pabellon",
  "pabellon",
  "derecho pabellon",
  "pabellon transitorio",
  "pabellon quirurgico",
  "quirofano",
  "farmacia en pabellon",
  "anestesia",
  "apendicectomia",
  "colecistectomia",
  "turbinectomia",
  "septoplastia",
  "rinoplastia",
  "neurectomia",
  "cesarea",
  "amigdalectomia",
  "cirugia",
];

const HOSPITAL_NURSING_CONTEXT_RULES = new Set([
  "CL-STAY-NURSING-001",
  "CL-STAY-NURSING-IV-002",
]);

function includesAnchor(value: string, anchors: string[]) {
  const normalized = normalize(value);
  return anchors.some((anchor) => normalized.includes(anchor));
}

function episodeContext(lines: ChileanBillingLine[]) {
  const hasHospitalStay = lines.some((line) =>
    includesAnchor(`${line.section ?? ""} ${line.subgroup ?? ""} ${line.description}`, HOSPITAL_STAY_ANCHORS),
  );
  const hasOperatingRoom = lines.some((line) =>
    includesAnchor(`${line.section ?? ""} ${line.subgroup ?? ""} ${line.description}`, OPERATING_ROOM_ANCHORS),
  );
  return {
    hasHospitalStay,
    hasOperatingRoom,
    noPavilionHospitalStay: hasHospitalStay && !hasOperatingRoom,
  };
}

function precedentComparisonsForLine(
  line: ChileanBillingLine,
  lines: ChileanBillingLine[],
): PrecedentComparison[] {
  const description = normalize(`${line.code ?? ""} ${line.description}`);
  const section = `${line.section ?? ""} ${line.subgroup ?? ""}`;
  const context = episodeContext(lines);
  const sectionFamily = inferSectionFamily(section);

  return CHILEAN_PRECEDENT_RULES.flatMap((precedent) => {
    const codeMatch = precedent.codes.some(
      (code) => code === line.code || code === line.fonasaCode,
    );
    const matchedTerms = precedent.terms.filter((term) =>
      description.includes(normalize(term)),
    );
    if (!codeMatch && matchedTerms.length === 0) return [];

    let comparability = codeMatch ? 0.62 : 0.48;
    const matchedFactors: string[] = [];
    const distinctionFactors: string[] = [];

    if (codeMatch) {
      matchedFactors.push("Coincide el código del insumo con el antecedente.");
    }
    if (matchedTerms.length > 0) {
      matchedFactors.push(
        `La glosa coincide con ${matchedTerms.map((term) => `“${term}”`).join(", ")}.`,
      );
      comparability += 0.1;
    }

    const targetIsHospital =
      precedent.outcomeBundle === "hospital_stay" ||
      precedent.outcomeBundle === "hospitalized_medication" ||
      precedent.outcome === "excluded";
    const targetIsOperatingRoom = precedent.outcomeBundle === "operating_room";
    const hospitalContext =
      context.hasHospitalStay || sectionFamily === "hospital_stay";
    const operatingRoomContext =
      context.hasOperatingRoom || sectionFamily === "operating_room";
    if (targetIsHospital && hospitalContext) {
      comparability += 0.14;
      matchedFactors.push("El episodio o la sección corresponde a hospitalización.");
    } else if (targetIsHospital) {
      distinctionFactors.push(
        "No se identificó todavía un ancla de hospitalización o Día Cama en el episodio.",
      );
    }

    if (targetIsOperatingRoom && operatingRoomContext) {
      comparability += 0.14;
      matchedFactors.push("El episodio o la sección contiene un ancla de pabellón.");
    } else if (targetIsOperatingRoom) {
      distinctionFactors.push(
        "No se identificó un ancla de pabellón; debe justificarse por qué el criterio de Derecho de Pabellón sería comparable.",
      );
    }

    if (targetIsHospital && context.noPavilionHospitalStay) {
      comparability += 0.1;
      matchedFactors.push("No se identificó ancla de pabellón en el episodio.");
    } else if (targetIsHospital && context.hasOperatingRoom) {
      distinctionFactors.push(
        "El episodio contiene un ancla de pabellón; debe explicarse por qué el criterio de hospitalización sería comparable.",
      );
    }

    if (line.amount !== 0) {
      comparability += 0.04;
      matchedFactors.push("El concepto aparece como cargo individualizado.");
    }

    const normalizedComparability = clamp(comparability);
    const status =
      normalizedComparability >= 0.8
        ? "strong_comparator"
        : normalizedComparability >= 0.55
          ? "partial_comparator"
          : "not_comparable";

    return [{
      precedentId: precedent.id,
      label: precedent.label,
      sourceReference: precedent.sourceReference,
      outcomeBundle: precedent.outcomeBundle,
      outcome: precedent.outcome,
      outcomeLabel: precedent.outcomeLabel,
      comparability: normalizedComparability,
      status,
      matchedFactors: unique(matchedFactors),
      missingEvidence: [
        "Contrato, plan, convenio y arancel aplicables al episodio",
        "Registro clínico o de uso que confirme la función del insumo",
        "Respuesta del prestador y de la Isapre sobre la diferencia de clasificación",
      ],
      distinctionFactors: unique(distinctionFactors),
      explanation:
        status === "strong_comparator"
          ? `${precedent.decisionOutcome} La coincidencia actual permite invocarlo como antecedente comparable, sujeto a validar el contrato y el contexto.`
          : `${precedent.decisionOutcome} La coincidencia es parcial; se requiere completar los factores de comparación antes de pedir el mismo tratamiento.`,
    }];
  });
}

function scoreLine(
  line: ChileanBillingLine,
  lines: ChileanBillingLine[],
  knowledge: InclusionKnowledge[],
): InclusionCandidate[] {
  const description = normalize(`${line.code ?? ""} ${line.description}`);
  const section = normalize(`${line.section ?? ""} ${line.subgroup ?? ""}`);
  const sectionFamily = inferSectionFamily(section);
  const professionalCharge =
    sectionFamily === "professional_fees" ||
    /valor arancelario anestesico|honorario|anestesiologo|cirujano/.test(description);
  const context = episodeContext(lines);
  const precedentComparisons = precedentComparisonsForLine(line, lines);
  const adjudicatedExclusion = precedentComparisons.find(
    (comparison) =>
      comparison.outcome === "excluded" &&
      comparison.comparability >= 0.8,
  );
  const strongAdjudicatedBundle = precedentComparisons.find(
    (comparison) =>
      comparison.outcome === "included" &&
      comparison.status === "strong_comparator",
  )?.outcomeBundle;
  const explicitHospitalSection = includesAnchor(
    `${line.section ?? ""} ${line.subgroup ?? ""}`,
    HOSPITAL_STAY_ANCHORS,
  );
  const evidence = knowledge.filter(
    (entry) =>
      entry.status !== "contradicted" &&
      entry.terms.some((term) => description.includes(normalize(term))) &&
      !(
        entry.id === "CL-PAB-CIRCULAR43-FULL-001" &&
        (!context.hasOperatingRoom || professionalCharge)
      ) &&
      (!strongAdjudicatedBundle || entry.bundle === strongAdjudicatedBundle) &&
      !(
        context.noPavilionHospitalStay &&
        entry.bundle === "operating_room"
      ) &&
      !(
        context.hasOperatingRoom &&
        HOSPITAL_NURSING_CONTEXT_RULES.has(entry.id) &&
        !explicitHospitalSection
      ),
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
  if (adjudicatedExclusion) return [];
  const bundles = unique(evidence.map((entry) => entry.bundle));

  return bundles.map((bundle) => {
    const matched = evidence.filter((entry) => entry.bundle === bundle);
    const precedentMatches = precedentComparisons.filter(
      (comparison) =>
        comparison.outcome === "included" &&
        comparison.outcomeBundle === bundle,
    );
    const precedentSupport = precedentMatches.length
      ? Math.max(...precedentMatches.map((comparison) => comparison.comparability))
      : 0;
    let probability = matched.length
      ? Math.max(...matched.map((entry) => entry.probability))
      : 0.45;
    const reasons = [
      ...(bundle === "hospital_stay" && context.noPavilionHospitalStay
        ? [
            "El episodio contiene habitación/hospitalización pediátrica y no presenta un ancla de pabellón; el material se interpreta primero como apoyo de enfermería del día cama.",
          ]
        : []),
      ...matched.map((entry) => entry.rationale),
    ];
    if (bundle === "hospital_stay" && context.noPavilionHospitalStay) {
      probability += 0.08;
    }
    if (sectionFamily === bundle) {
      probability += 0.1;
      reasons.push(`La sección chilena “${line.section ?? line.subgroup}” apunta al mismo contexto.`);
    }
    if (linkedFamilies.has(bundle)) {
      probability += 0.08;
      reasons.push("Comparte fecha y número documental con una prestación principal del mismo contexto.");
    }
    if (precedentSupport > 0) {
      probability += Math.min(0.3, precedentSupport * 0.32);
      reasons.push(
        `Existe un antecedente arbitral comparable (${Math.round(precedentSupport * 100)}% de comparabilidad); puede invocarse igualdad ante la ley para pedir un trato coherente caso a caso, sin convertirlo en cobertura automática.`,
      );
      if (precedentMatches.some((comparison) => comparison.status !== "strong_comparator")) {
        reasons.push("La comparabilidad es parcial y requiere justificar las diferencias del nuevo episodio.");
      }
    }
    const needsContract = matched.some(
      (entry) => entry.scope !== "general_chile" && entry.status !== "confirmed",
    );
    const missingEvidence = needsContract
      ? ["Contrato, convenio o resolución aplicable al episodio"]
      : [];
    if (precedentMatches.length > 0) {
      missingEvidence.push(
        "Verificar equivalencia material del antecedente: ítem, episodio, función, contrato y registro de uso",
      );
    }
    return {
      bundle,
      probability: clamp(probability),
      knowledgeIds: matched.map((entry) => entry.id),
      precedentIds: precedentMatches.map((comparison) => comparison.precedentId),
      precedentSupport: Number(precedentSupport.toFixed(3)),
      reasons: unique(reasons),
      missingEvidence: unique(missingEvidence),
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

function buildReasoningFindings(lines: ChileanBillingLine[]): ReasoningFinding[] {
  const lineText = (line: ChileanBillingLine) =>
    normalize(`${line.description} ${line.section ?? ""} ${line.subgroup ?? ""}`);
  const codingLines = lines.filter((line) =>
    /00 00 000 00|pna|gnc|no codific|sin codigo|sin codigo/.test(lineText(line)),
  );
  const exclusionLines = lines.filter((line) =>
    /no cubiert|exclu|rechaz|no bonif|sin cobertura|pna|gnc/.test(lineText(line)),
  );
  const operatingRoomLines = lines.filter((line) =>
    includesAnchor(lineText(line), OPERATING_ROOM_ANCHORS),
  );
  const budgetLines = lines.filter((line) =>
    /presupuesto|cotizacion|pre presupuesto/.test(lineText(line)),
  );
  const source = {
    coding: "Jurisprudencia SIS, Rol Arbitral 10492-2013, p. 60; Rol 4063244-2025, considerandos 4-6",
    exclusion: "Jurisprudencia SIS, Rol Administrativo 1508-2014, p. 65; Compendio Beneficios, pp. 10-12",
    integral: "Circular N.º 43 y Compendio de Procedimientos, Apéndice del Anexo N.º 4, Derecho de Pabellón, pp. 113-116; Jurisprudencia SIS, Rol Administrativo 1037885-2013, pp. 80-83; Rol Arbitral 4063244-2025, considerando 7",
    information: "Jurisprudencia SIS, Rol Arbitral 24893-2013, pp. 73-79; Compendios de Beneficios y Contratos",
    budget: "Jurisprudencia SIS, Rol Administrativo 200074-2013, p. 84",
    procedure: "Compendio Procedimientos, Capítulo V, pp. 288-300",
  };
  const findings: ReasoningFinding[] = [
    {
      id: "SUP-CODING-ERROR-001",
      title: "La codificación no debe trasladar automáticamente el costo al paciente",
      status: codingLines.length ? "relevant" : "not_triggered",
      explanation:
        "Si la diferencia proviene de cómo el prestador o la Isapre codificó una prestación, debe compararse el servicio efectivamente realizado con el arancel, el plan y el PAM. La jurisprudencia reconoce que una diferencia de codificación en un prestador preferente no puede perjudicar al beneficiario; si el servicio carece de código, la homologación requiere el cauce y la justificación correspondientes.",
      action:
        "Solicitar código aplicado, código FONASA o equivalente, regla de homologación, programa médico, plan y explicación escrita de quién asumió la diferencia.",
      matchedLineIds: codingLines.map((line) => line.id),
      evidenceToRequest: [
        "Arancel y tabla de homologaciones aplicada",
        "PAM o liquidación con código y motivo de rechazo",
        "Programa médico, ficha o registro que pruebe la prestación efectivamente realizada",
      ],
      sourceReferences: [source.coding],
    },
    {
      id: "SUP-RESTRICTIVE-EXCLUSION-001",
      title: "Las exclusiones requieren fundamento y prueba suficiente",
      status: exclusionLines.length ? "relevant" : "not_triggered",
      explanation:
        "Una glosa de exclusión, no bonificación o PNA/GNC no demuestra por sí sola que el cargo esté fuera de cobertura. Las exclusiones son excepcionales y restrictivas: la institución debe identificar la cláusula, el concepto legal o contractual y los antecedentes que lo acreditan. La duda no se resuelve convirtiendo una inferencia en certeza.",
      action:
        "Pedir la cláusula exacta, el fundamento técnico-contractual, la prueba de la exclusión y la razón por la que no se aplicó un rubro principal o una cobertura mínima.",
      matchedLineIds: exclusionLines.map((line) => line.id),
      evidenceToRequest: [
        "Contrato, plan, arancel y norma técnico-administrativa vigente",
        "Comunicación escrita de la negativa o restricción",
        "Antecedentes clínicos que sostengan la causal invocada",
      ],
      sourceReferences: [source.exclusion],
    },
    {
      id: "SUP-INTEGRAL-CHARGE-001",
      title: "Control de integralidad y cobro separado",
      status: operatingRoomLines.length > 0 ? "needs_evidence" : "not_triggered",
      explanation:
        "Con pabellón confirmado, la Circular N.º 43 y su apéndice establecen un alcance amplio que comprende sala y recuperación, equipos y no fungibles, insumos desechables o recuperables, fungibles generales, gases y anestésicos. Además, cuando una maniobra necesaria forma parte de un procedimiento de mayor complejidad sin código independiente, la jurisprudencia exige controlar su integralidad. La revisión debe identificar qué se usó y qué regla concreta permitiría el cobro separado.",
      action:
        "Comparar protocolo operatorio, registro de uso, código independiente, descripción del procedimiento y composición contractual del pabellón.",
      matchedLineIds: operatingRoomLines.map((line) => line.id),
      evidenceToRequest: [
        "Protocolo operatorio o registro del procedimiento",
        "Arancel con código de la maniobra y de la prestación principal",
        "Composición contractual del Derecho de Pabellón y materiales incluidos",
      ],
      sourceReferences: [source.integral],
    },
    {
      id: "SUP-INFORMATION-PAYMENT-001",
      title: "La modalidad de pago y el rechazo deben ser comprensibles",
      status: lines.length ? "needs_evidence" : "not_triggered",
      explanation:
        "La cobertura no se puede auditar mirando sólo el cargo o sólo el PAM. Deben reconstruirse la modalidad de pago, los conceptos excluidos del convenio prestador-Isapre, la liquidación, el copago y la comunicación escrita del rechazo. La jurisprudencia vinculó la falta de esa información con la pérdida práctica de la oportunidad de pedir cobertura.",
      action:
        "Solicitar cuenta pormenorizada, PAM/liquidación, modalidad de pago, prestaciones excluidas del convenio, fecha de solicitud y respuesta escrita.",
      matchedLineIds: lines.map((line) => line.id),
      evidenceToRequest: [
        "Cuenta con glosa, código, fecha, cantidad, valor unitario y total",
        "PAM, liquidación, copago y modalidad de pago",
        "Carta de negativa o restricción y fecha de notificación",
      ],
      sourceReferences: [source.information],
    },
    {
      id: "SUP-BUDGET-CODE-001",
      title: "El presupuesto se contrasta con lo efectivamente realizado",
      status: budgetLines.length ? "relevant" : "not_triggered",
      explanation:
        "Un presupuesto puede ser vinculante para la Isapre cuando contiene los mismos códigos de las prestaciones efectivamente otorgadas y éstas se realizaron en las condiciones presupuestadas. Por eso no basta con comparar sólo el monto total.",
      action:
        "Cruzar presupuesto, códigos, condiciones de atención, cuenta final y PAM; registrar cualquier diferencia de glosa o de prestación.",
      matchedLineIds: budgetLines.map((line) => line.id),
      evidenceToRequest: [
        "Presupuesto aprobado y fecha de emisión",
        "Cuenta final y PAM con códigos equivalentes",
        "Registro de las condiciones efectivamente otorgadas",
      ],
      sourceReferences: [source.budget],
    },
    {
      id: "SUP-PROCEDURAL-CHAIN-001",
      title: "La evidencia debe preparar el ciclo de reclamo",
      status: lines.length ? "needs_evidence" : "not_triggered",
      explanation:
        "El motor debe ordenar la aclaración antes de escalar: reclamo escrito al reclamado, constancia de recepción, respuesta fundada y expediente; luego, si persiste la controversia, reclamo administrativo ante la Superintendencia con copia de la presentación y de la respuesta o del vencimiento del plazo. La matriz de cuenta es evidencia de apoyo, no reemplaza ese procedimiento.",
      action:
        "Conservar fechas, folios, respuestas, documentos y diferencias; generar peticiones separadas para prestador, Isapre y Superintendencia.",
      matchedLineIds: lines.map((line) => line.id),
      evidenceToRequest: [
        "Constancia de reclamo al prestador y respuesta",
        "Constancia de reclamo a la Isapre y respuesta fundada",
        "Cuenta, PAM, contrato, arancel y antecedentes de uso ordenados por folio",
      ],
      sourceReferences: [source.procedure],
    },
  ];
  return findings;
}

export function analyzeClinicalAccount(
  lines: ChileanBillingLine[],
  knowledge: InclusionKnowledge[] = DEFAULT_CHILEAN_INCLUSION_KNOWLEDGE,
): ClinicalAccountAnalysis {
  const functionalEquivalenceAlerts = findFunctionalEquivalenceAlerts(lines);
  return {
    version: "cl-account-v5",
    claimFramework: UNIVERSAL_CLAIM_FRAMEWORK,
    equalityProjection: EQUALITY_PROJECTION_FRAMEWORK,
    operatingRoomFramework: FULL_OPERATING_ROOM_FRAMEWORK,
    lineAssessments: lines.map((line) => ({
      line,
      normalizedSection: normalize(`${line.section ?? ""} ${line.subgroup ?? ""}`),
      candidates: scoreLine(line, lines, knowledge),
      observedEquivalents: findObservedEquivalents(line),
      functionalEquivalenceAlerts: functionalEquivalenceAlerts.filter((alert) => alert.lineId === line.id),
      precedentComparisons: precedentComparisonsForLine(line, lines),
    })),
    functionalEquivalenceAlerts,
    anomalies: detectAnomalies(lines),
    reasoningFindings: buildReasoningFindings(lines),
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
      "El Apéndice del Anexo N.º 4 contiene una lista amplia de categorías de pabellón, pero no resuelve por sí solo toda marca, presentación, implante o condición contractual.",
      "Con pabellón confirmado, los cargos separados que correspondan a equipos, no fungibles, desechables, recuperables, fungibles generales, gases o anestésicos activan una presunción técnica de inclusión para revisión y una carga de explicación del cobro separado.",
      "La conclusión económica requiere el contrato, convenio, arancel o decisión regulatoria aplicable.",
      "Un antecedente arbitral comparable permite solicitar trato coherente por igualdad ante la ley, pero no crea cobertura automática ni reemplaza la homologación o la decisión del caso nuevo.",
      "La sentencia arbitral aporta varias conclusiones distintas: medicamento hospitalizado, Día Cama, Derecho de Pabellón y una exclusión concreta. Cada una se compara por separado y puede producir un resultado distinto.",
      "La jurisprudencia sobre codificación, integralidad, exclusiones, información y presupuestos se usa como regla de control y solicitud de evidencia, no como presunción automática de cobertura.",
      "Las alertas de equivalencia funcional recorren el corpus observado completo y agrupan productos por función clínica, no sólo por glosa, marca o código. El nivel alto/medio/contexto orienta la revisión y no reemplaza el registro de uso.",
      "Una alerta puede apuntar a más de un destino funcional (por ejemplo, vía venosa y medicamento hospitalizado); el motor no suma esos destinos ni los convierte automáticamente en monto recuperable.",
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
