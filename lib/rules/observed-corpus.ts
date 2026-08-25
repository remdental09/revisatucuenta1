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

/**
 * A new account is kept as a desidentified observation. It is deliberately
 * smaller than a billing line: page, date, document ids and professional ids
 * are not part of the learning record.
 */
export type ObservedCorpusContribution = {
  caseKey: string;
  sourceKinds?: Array<"account" | "pam">;
  sourceDocumentIds?: string[];
  provider?: string;
  episodeClass: string;
  sourceLineCount: number;
  observedLineCount: number;
  coverage?: ObservedCorpusCase["coverage"];
  coverageNote?: string;
  lines: Array<{
    sourceKind?: "account" | "pam";
    description: string;
    amount: number;
    code?: string;
    fonasaCode?: string;
    section?: string;
    subgroup?: string;
    quantity?: number;
    unitAmount?: number;
    provider?: string;
  }>;
};

export type CorpusLookupLine = {
  id?: string;
  description: string;
  code?: string;
  fonasaCode?: string;
  section?: string;
  subgroup?: string;
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

export type FunctionalTargetBundle =
  | "operating_room"
  | "hospital_stay"
  | "hospitalized_medication"
  | "personal_item_review";

export type FunctionalEquivalenceFamilyId =
  | "iv_access_and_infusion"
  | "iv_site_care"
  | "injection_and_sample_collection"
  | "general_nursing_care"
  | "bedside_monitoring"
  | "hospitalized_medication"
  | "full_operating_room_scope"
  | "surgical_field_and_dressing"
  | "surgical_access_and_consumables"
  | "surgical_anesthesia_and_monitoring"
  | "thromboembolic_prevention"
  | "personal_hygiene";

export type FunctionalAlertLevel = "high" | "medium" | "context";

export type FunctionalEquivalenceAlert = {
  lineId: string;
  lineDescription: string;
  familyId: FunctionalEquivalenceFamilyId;
  familyLabel: string;
  targetBundles: FunctionalTargetBundle[];
  alertLevel: FunctionalAlertLevel;
  comparability: number;
  matchedSignals: string[];
  observedPatternCount: number;
  observedObservationCount: number;
  matchedObservedPatterns: string[];
  observedCaseKeys: string[];
  precedentIds: string[];
  sourceBasis: string[];
  rationale: string;
  evidenceToRequest: string[];
  caution: string;
};

export const OBSERVED_CHILEAN_ACCOUNT_CORPUS = corpusData as ObservedCorpus;

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const uniqueValues = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));

function updateMin(current: number | null, next: number | undefined) {
  return next == null || !Number.isFinite(next) ? current : current == null ? next : Math.min(current, next);
}

function updateMax(current: number | null, next: number | undefined) {
  return next == null || !Number.isFinite(next) ? current : current == null ? next : Math.max(current, next);
}

/**
 * Merges only validated, desidentified account observations into the static
 * corpus. It never modifies the shipped JSON and never creates legal rules.
 */
export function mergeObservedCorpus(
  base: ObservedCorpus,
  contributions: ObservedCorpusContribution[],
): ObservedCorpus {
  const existingCases = new Set(base.cases.map((item) => item.caseKey));
  const accepted = contributions.filter((contribution) => !existingCases.has(contribution.caseKey));
  const cases = base.cases.map((item) => ({ ...item }));
  const patterns = new Map<string, ObservedItemPattern>(
    base.patterns.map((pattern) => [pattern.normalizedDescription, {
      ...pattern,
      aliases: [...pattern.aliases],
      codes: [...pattern.codes],
      fonasaCodes: [...pattern.fonasaCodes],
      providers: [...pattern.providers],
      sections: [...pattern.sections],
      caseKeys: [...pattern.caseKeys],
    }]),
  );
  let additionalObservations = 0;

  for (const contribution of accepted) {
    cases.push({
      caseKey: contribution.caseKey,
      provider: contribution.provider || "No informado",
      episodeClass: contribution.episodeClass || "Cuenta clínica",
      sourceLineCount: contribution.sourceLineCount,
      observedLineCount: contribution.observedLineCount,
      coverage: contribution.coverage || "verified_fragmentation_subset",
      coverageNote: contribution.coverageNote || "Observación incorporada después de revisión interna.",
    });
    for (const line of contribution.lines) {
      const description = line.description.trim();
      const normalizedDescription = normalize(description);
      if (!normalizedDescription) continue;
      additionalObservations += 1;
      const sectionValues = uniqueValues([line.section, line.subgroup]);
      const providerValues = uniqueValues([line.provider, contribution.provider]);
      const current = patterns.get(normalizedDescription);
      if (!current) {
        patterns.set(normalizedDescription, {
          description,
          normalizedDescription,
          aliases: [],
          codes: uniqueValues([line.code]),
          fonasaCodes: uniqueValues([line.fonasaCode]),
          providers: providerValues,
          sections: sectionValues,
          caseKeys: [contribution.caseKey],
          observationCount: 1,
          zeroValueCount: line.amount === 0 ? 1 : 0,
          refundCount: line.amount < 0 ? 1 : 0,
          unitPriceMin: updateMin(null, line.unitAmount),
          unitPriceMax: updateMax(null, line.unitAmount),
          totalMin: updateMin(null, line.amount),
          totalMax: updateMax(null, line.amount),
        });
        continue;
      }
      if (description !== current.description && !current.aliases.includes(description)) current.aliases.push(description);
      current.codes = uniqueValues([...current.codes, line.code]);
      current.fonasaCodes = uniqueValues([...current.fonasaCodes, line.fonasaCode]);
      current.providers = uniqueValues([...current.providers, ...providerValues]);
      current.sections = uniqueValues([...current.sections, ...sectionValues]);
      current.caseKeys = uniqueValues([...current.caseKeys, contribution.caseKey]);
      current.observationCount += 1;
      if (line.amount === 0) current.zeroValueCount += 1;
      if (line.amount < 0) current.refundCount += 1;
      current.unitPriceMin = updateMin(current.unitPriceMin, line.unitAmount);
      current.unitPriceMax = updateMax(current.unitPriceMax, line.unitAmount);
      current.totalMin = updateMin(current.totalMin, line.amount);
      current.totalMax = updateMax(current.totalMax, line.amount);
    }
  }

  return {
    ...base,
    version: accepted.length ? `${base.version}+incremental-v1` : base.version,
    caseCount: base.caseCount + accepted.length,
    observationCount: base.observationCount + additionalObservations,
    patternCount: patterns.size,
    cases,
    patterns: [...patterns.values()],
  };
}

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

type FunctionalRule = {
  id: FunctionalEquivalenceFamilyId;
  label: string;
  terms: string[];
  sectionTerms?: string[];
  targetBundles: FunctionalTargetBundle[];
  precedentIds: string[];
  sourceBasis: string[];
  rationale: string;
  evidenceToRequest: string[];
  requiresHospitalContext?: boolean;
  requiresOperatingRoom?: boolean;
  medicationLike?: boolean;
};

const HOSPITAL_CONTEXT_TERMS = [
  "dia cama", "hospitalizacion", "hospitalizado", "habitacion", "pediatria",
  "sala cuna", "nursery", "uti", "uci", "atencion cerrada", "urgencia",
];

const OPERATING_ROOM_CONTEXT_TERMS = [
  "derecho de pabellon", "pabellon", "pabellon transitorio", "quirofano",
  "farmacia en pabellon", "anestesia", "apendicectomia", "colecistectomia",
  "turbinectomia", "septoplastia", "rinoplastia", "neurectomia", "cesarea",
  "cirugia",
];

const MEDICATION_TERMS = [
  "lubricante ocular", "duratears", "unguento oftalmico", "colirio", "lagrimas artificiales",
  "gotas oftalmicas", "pomada", "crema", "paracetamol", "metronidazol", "ondansetron",
  "odanex", "dipirona", "ceftriaxona", "tramadol", "enoxaparina", "enoxaparin",
  "omeprazol", "parecoxib", "amoxicilina", "propofol", "rocuronio", "remifentanilo",
  "sevoflurano", "sugammadex", "atropina", "efedrina", "metadona", "suero fisiologico",
  "ringer lactato", "suero premix", "agua esteril",
];

const MATERIAL_LIKE_TERMS = [
  "jeringa", "aguja", "cateter", "jelco", "mariposa", "gasa", "torula", "aposito",
  "tegaderm", "bajada", "tapa", "llave", "sonda", "electrodo", "oxisensor", "guante",
  "canula", "tubo", "liga elastica", "kit hemocultivo", "removedor", "termometro",
];

const FUNCTIONAL_RULES: FunctionalRule[] = [
  {
    id: "iv_access_and_infusion",
    label: "Acceso venoso, fleboclisis y circuito de infusión",
    terms: [
      "jelco", "cateter i v", "cat i v", "cateter iv", "branula", "mariposa intrav",
      "via venosa", "instalacion de via venosa", "fleboclisis", "bajada estandar", "bajada standar",
      "bajada macrogoteo", "tapa clave", "llave 3 pasos", "llave tres pasos", "tapones luer",
      "alargador venoso", "suero fisiologico", "ringer lactato", "suero premix", "volumetrico",
      "bomba fresenius", "adaptador suero", "tapa antirreflujo", "equipo fleboclisis",
    ],
    targetBundles: ["hospital_stay", "hospitalized_medication"],
    precedentIds: ["SUP-ARB-4063244-2025-DIACAMA-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: instalación de vía venosa y fleboclisis proyectadas a Día Cama en el episodio resuelto",
      "Compendio de instrumentos contractuales: materiales y equipos de fleboclisis dentro de las categorías funcionales hospitalarias, sujeto al contrato",
      "Jurisprudencia revisada sobre integralidad: la maniobra necesaria debe contrastarse con la prestación principal y su registro de uso",
    ],
    rationale: "La glosa puede ser otra marca, calibre o presentación, pero cumple una función equivalente de acceso, administración o mantención intravenosa.",
    evidenceToRequest: ["Registro de instalación y administración", "Fecha, cantidad y unidad de uso", "Contrato, convenio, arancel y respuesta de cobertura"],
    requiresHospitalContext: true,
  },
  {
    id: "iv_site_care",
    label: "Fijación, antisepsia y cuidado del sitio intravenoso",
    terms: [
      "tegaderm", "aposito tegaderm", "aposito quir", "aposito", "prot cutaneo", "skin remove",
      "removedor de adhesivo", "removedor adhesivo", "toallita c alcohol", "toallita alcohol esteril",
      "sachet gasa c alcohol", "alcohol", "micropore", "tela transpore", "cavilon", "fijador sonda",
    ],
    targetBundles: ["hospital_stay", "operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-DIACAMA-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: removedor de adhesivos incorporado a Día Cama en el caso resuelto",
      "Compendio contractual: apósitos, cintas y elementos de acceso aparecen como categorías funcionales, con distinción entre hospitalización y pabellón",
      "Definición operativa de cuidados de enfermería: la equivalencia se propone por función de fijar, proteger o retirar adhesivos",
    ],
    rationale: "Son consumibles que permiten instalar, proteger, mantener o retirar una vía o una curación; la función exacta debe confirmarse en el registro clínico.",
    evidenceToRequest: ["Nota de enfermería o curación", "Sitio anatómico y procedimiento asociado", "Indicación de si se usó en habitación o pabellón"],
    requiresHospitalContext: true,
  },
  {
    id: "injection_and_sample_collection",
    label: "Inyecciones, punciones y toma de muestras",
    terms: [
      "jeringa", "aguja", "mariposa", "liga elastica para puncion", "kit hemocultivo", "hemocultivo",
      "jeringa gases", "gases arteriales", "toma de muestra", "toma muestra", "tubo muestra", "tubo lila",
    ],
    targetBundles: ["hospital_stay", "operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-DIACAMA-001"],
    sourceBasis: [
      "Definición operativa de Día Cama aportada al expediente: inyecciones y toma de muestras",
      "Compendio de instrumentos contractuales: agujas, jeringas, catéteres y conexiones como categorías de insumos clínicos",
      "Rol arbitral 4063244-2025: comparación funcional de insumos, no de la marca comercial",
    ],
    rationale: "La combinación de jeringas, agujas, mariposas o kits de muestra puede representar una maniobra de enfermería aunque las glosas estén separadas.",
    evidenceToRequest: ["Orden y registro de administración o toma de muestra", "Resultado o identificación de la muestra", "Sección y prestación a la que se imputó el insumo"],
    requiresHospitalContext: true,
  },
  {
    id: "general_nursing_care",
    label: "Curaciones, sondas y cuidados generales de enfermería",
    terms: [
      "termometro", "removedor de adhesivo", "delantal paciente", "equipo curacion", "curacion", "gasa",
      "torula", "sonda aspiracion", "sonda foley", "sonda nelaton", "sonda", "fleboclisis", "paño baño paciente",
    ],
    targetBundles: ["hospital_stay"],
    precedentIds: ["SUP-ARB-4063244-2025-DIACAMA-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: termómetro digital, removedor y elementos de hospitalización sumados a Día Cama",
      "Definición operativa de Día Cama aportada al expediente: curaciones, sondas, inyecciones, toma de muestras y administración de fleboclisis",
      "Jurisprudencia revisada sobre integralidad de maniobras necesarias a una prestación principal",
    ],
    rationale: "Agrupa insumos cuya función observable es medir, curar, sondar o apoyar el cuidado de enfermería durante la estancia.",
    evidenceToRequest: ["Hoja de enfermería y signos vitales", "Registro de curación o instalación de sonda", "Composición del cargo diario de habitación"],
    requiresHospitalContext: true,
  },
  {
    id: "bedside_monitoring",
    label: "Control y monitorización al lado de la cama",
    terms: ["termometro", "oxisensor", "oximetro", "electrodos", "sensor saturacion", "monitor signos vitales"],
    targetBundles: ["hospital_stay", "operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-DIACAMA-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: termómetro digital incorporado a Día Cama en el caso resuelto",
      "Corpus observado: termómetros, oxisensores y electrodos aparecen en hospitalización, urgencia y pabellón; el contexto decide la ruta de revisión",
    ],
    rationale: "La misma familia de control puede estar en habitación, urgencia o pabellón; por eso la alerta se condiciona al lugar real de uso.",
    evidenceToRequest: ["Hoja de signos vitales o registro de monitorización", "Lugar y hora de uso", "Cargo que ya incluye la monitorización"],
    requiresHospitalContext: true,
  },
  {
    id: "hospitalized_medication",
    label: "Medicamentos administrados durante hospitalización",
    terms: MEDICATION_TERMS,
    sectionTerms: ["medicamentos hospitalizados", "farmacia hospitalizacion", "medicamentos y materiales", "medicamentos e insumos", "farmacia farmacos"],
    targetBundles: ["hospitalized_medication"],
    precedentIds: ["SUP-ARB-4063244-2025-MED-HOSP-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: lubricante ocular clasificado en Medicamentos Hospitalizados en el episodio resuelto",
      "Compendio de instrumentos contractuales: medicamentos y materiales utilizados durante hospitalización deben separarse y contrastarse con el contrato",
      "Compendio de beneficios: la cobertura depende del plan, valor real, topes y condiciones contractuales",
    ],
    rationale: "Detecta medicamentos con función administrada durante el episodio, incluidos equivalentes tópicos, oftálmicos, inyectables y soluciones; no decide si están incluidos en Día Cama.",
    evidenceToRequest: ["Orden médica y registro de administración", "Principio activo, presentación y cantidad", "Ítem contractual, cobertura y tope aplicados"],
    requiresHospitalContext: true,
    medicationLike: true,
  },
  {
    id: "full_operating_room_scope",
    label: "Alcance integral del Derecho de Pabellón (Circular 43)",
    terms: [
      "aspiracion", "bomba aspiracion", "receptal", "oxigeno", "aire comprimido",
      "kit anestesia", "maquina anestesia", "tubo endotraqueal", "entubacion traqueal",
      "monitor", "sensor", "electrodo", "oxisensor", "resucitador", "conexion", "conector",
      "electrobisturi", "lapiz electrobisturi", "placa valleylab", "micropunta", "laser quirurgico",
      "600510244 alargador",
      "ventilacion mecanica", "endoscopia", "laparoscopia", "microscopio",
      "hoja bisturi", "hojas bisturi", "cateter", "cat i v", "branula", "intrafix",
      "adaptador suero", "tubo ext c llave", "delantal esteril", "bata quirurgica", "ropa esteril",
      "bata quirur", "alargador de tubo hme", "humidificador",
      "jeringa", "aguja", "fleboclisis", "bajada", "tapa", "tapon", "llave 3 pasos",
      "guante", "drenaje", "canula", "sonda", "pano esteril", "campo quirurgico",
      "gasa", "algodon", "torula", "aposito", "tela adhesiva", "micropore", "tegaderm",
      "antiseptico", "desinfectante", "povidona", "clorhexidina", "formalina",
      "allevyn", "hisopo esteril", "lapiz marcador", "mascarilla multivent", "tubo endot",
      "jabon quirurgico", "esponja con jabon", "escobilla", "sutura", "sutupack", "vicryl", "monocryl",
      "prolene", "ethilon", "pds", "surgitie", "propofol", "rocuronio", "remifentanilo",
      "sevoflurano", "sugammadex", "bupivacaina", "lidocaina", "medias antiembol",
      "anestesico", "oxido nitroso", "aire medicinal",
      "manga piernera", "compresor neumatico", "calzon clinico", "cobertor underbody",
    ],
    targetBundles: ["operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-PAB-001"],
    sourceBasis: [
      "Circular N.º 43 y Apéndice del Anexo N.º 4: alcance amplio del Derecho de Pabellón",
      "Compendio de Procedimientos, pp. 113-116: sala, recuperación, equipos, no fungibles, desechables, recuperables, fungibles generales, gases y anestésicos",
      "Rol arbitral 4063244-2025: aplicación concreta a varios elementos quirúrgicos; proyección controlada por equivalencia material",
    ],
    rationale: "Con pabellón confirmado, la glosa coincide con una categoría expresamente comprendida en el alcance general del Derecho de Pabellón; el cobro separado debe justificarse con una diferencia técnica y contractual verificable.",
    evidenceToRequest: ["Protocolo operatorio y hoja de anestesia", "Registro de consumo en pabellón o recuperación", "Contrato, convenio, arancel y fundamento del cobro separado"],
    requiresOperatingRoom: true,
  },
  {
    id: "surgical_field_and_dressing",
    label: "Campo estéril, asepsia y curación quirúrgica",
    terms: [
      "gasa", "torula", "aposito", "guante quirurgico", "delantal esteril", "esponja quirurgica", "esponja con jabon",
      "compresa", "campo quirurgico", "kit de aseo quirurgico", "povidona", "clorhexidina", "jabon quirurgico",
      "cepillo quirurgico", "antiseptico", "desinfectante", "hoja bisturi", "bisturi",
    ],
    targetBundles: ["operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-PAB-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: esponja con jabón neutro y delantal estéril sumados a Derecho de Pabellón",
      "Compendio de instrumentos contractuales: gasas, apósitos, ropa estéril, antisepsia y material de campo como categorías del pabellón",
    ],
    rationale: "La función es preparar, mantener o cerrar el campo quirúrgico; se alerta sólo con un ancla de pabellón o cirugía verificable.",
    evidenceToRequest: ["Protocolo operatorio", "Registro de pabellón y cantidad usada", "Regla contractual de Derecho de Pabellón y cargos separables"],
    requiresOperatingRoom: true,
  },
  {
    id: "surgical_access_and_consumables",
    label: "Acceso, aspiración, drenaje y consumibles quirúrgicos",
    terms: [
      "aguja", "jeringa", "cateter", "canula", "sonda", "drenaje", "equipo fleboclisis", "bajada",
      "tubo aspiracion", "sonda aspiracion", "receptal", "tubo endotraqueal", "suturas", "vicryl", "monocryl",
      "prolene", "ethilon", "pds", "surgitie", "contador d aguja", "electrobisturi", "lapiz electrobisturi",
      "placa valleylab", "micropunta",
    ],
    targetBundles: ["operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-PAB-001"],
    sourceBasis: [
      "Compendio de instrumentos contractuales: catéteres, sondas, drenajes, equipos de infusión, suturas y electrocirugía como categorías funcionales de pabellón",
      "Jurisprudencia revisada sobre integralidad: una maniobra necesaria sin código independiente debe analizarse como parte del procedimiento de mayor complejidad",
    ],
    rationale: "La marca, calibre o código puede variar sin cambiar la función quirúrgica; requiere protocolo y regla contractual para distinguir inclusión de cobro separado.",
    evidenceToRequest: ["Protocolo operatorio y hoja de anestesia", "Código y arancel del procedimiento principal", "Detalle de consumos y autorización de cargos especiales"],
    requiresOperatingRoom: true,
  },
  {
    id: "surgical_anesthesia_and_monitoring",
    label: "Anestesia y monitorización perioperatoria",
    terms: [
      "propofol", "rocuronio", "remifentanilo", "sevoflurano", "sugammadex", "atropina", "efedrina", "metadona",
      "kit anestesia", "kit de anestesia", "sensor sedline", "monitor anestesia", "electrodos", "oxisensor", "oximetro",
    ],
    targetBundles: ["operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-PAB-001"],
    sourceBasis: [
      "Compendio de instrumentos contractuales: anestesia, oxigenoterapia y monitorización como categorías ligadas al pabellón",
      "Corpus observado: fármacos y kits de anestesia se repiten en episodios quirúrgicos con glosas variables",
    ],
    rationale: "Levanta una alerta cuando el producto parece cumplir una función anestésica o de monitorización, sin afirmar que el cargo deba integrarse automáticamente.",
    evidenceToRequest: ["Hoja anestésica y registro de monitor", "Procedimiento y tiempo de uso", "Contrato, arancel y fundamento del cobro separado"],
    requiresOperatingRoom: true,
  },
  {
    id: "thromboembolic_prevention",
    label: "Prevención tromboembólica perioperatoria",
    terms: ["medias antiembolicas", "medias antiembolismo", "manga piernera antiemb", "mangas compresor neumatico", "compresor neumatico", "calzon clinico"],
    targetBundles: ["operating_room"],
    precedentIds: ["SUP-ARB-4063244-2025-PAB-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: medias antiembólicas, calzón clínico y mangas para compresor neumático sumados a Derecho de Pabellón",
      "Corpus observado: variantes de medias antiembólicas aparecen con distintas glosas y proveedores en episodios quirúrgicos",
    ],
    rationale: "Agrupa equivalentes funcionales de compresión o prevención tromboembólica; la alerta exige confirmar su uso perioperatorio.",
    evidenceToRequest: ["Registro de colocación y retiro", "Protocolo operatorio o indicación médica", "Cargo de pabellón y regla de cobertura aplicada"],
    requiresOperatingRoom: true,
  },
  {
    id: "personal_hygiene",
    label: "Artículos personales e higiene del paciente",
    terms: ["set de aseo", "set aseo", "aseo personal", "paño baño paciente", "paño baño seco", "higiene paciente"],
    targetBundles: ["personal_item_review"],
    precedentIds: ["SUP-ARB-4063244-2025-EXCL-001"],
    sourceBasis: [
      "Rol arbitral 4063244-2025: el Set de Aseo Personal Adulto permaneció sin cobertura en el episodio resuelto",
      "Límite de igualdad ante la ley: una exclusión concreta debe compararse caso a caso y no trasladarse mecánicamente a todo plan",
    ],
    rationale: "La alerta sirve para revisar si el cobro es un artículo personal, un insumo de enfermería o una prestación incluida; no lo presenta como Día Cama.",
    evidenceToRequest: ["Descripción exacta y destinatario del artículo", "Uso clínico documentado o entrega personal", "Composición del Día Cama y regla contractual"],
    requiresHospitalContext: true,
  },
];

function hasAnyTerm(value: string, terms: string[]) {
  return terms.filter((term) => value.includes(normalize(term)));
}

function sectionAndDescription(line: CorpusLookupLine) {
  return normalize(`${line.section ?? ""} ${line.subgroup ?? ""} ${line.code ?? ""} ${line.description}`);
}

function contextForCorpus(lines: CorpusLookupLine[]) {
  const all = normalize(lines.map((line) => `${line.section ?? ""} ${line.subgroup ?? ""} ${line.description}`).join(" "));
  return {
    hasHospital: HOSPITAL_CONTEXT_TERMS.some((term) => all.includes(normalize(term))),
    hasOperatingRoom: OPERATING_ROOM_CONTEXT_TERMS.some((term) => all.includes(normalize(term))),
  };
}

function isMedicationLike(lineText: string, sectionText: string) {
  if (hasAnyTerm(lineText, MEDICATION_TERMS).length > 0) return true;
  const hasDose = /\b\d+(?:[.,]\d+)?\s*(mg|mcg|g|ml|cc|ui|%)\b/.test(lineText);
  const materialLike = hasAnyTerm(lineText, MATERIAL_LIKE_TERMS).length > 0;
  return hasDose && !materialLike && /medicamento|farmacia|farmacos|f\u00e1rmacos/.test(sectionText);
}

function observedSupportForRule(rule: FunctionalRule, corpus: ObservedCorpus) {
  const matchingPatterns = corpus.patterns
    .filter((pattern) => hasAnyTerm(normalize(pattern.description), rule.terms).length > 0)
    .sort((left, right) => right.observationCount - left.observationCount);
  return {
    patterns: matchingPatterns,
    patternCount: matchingPatterns.length,
    observationCount: matchingPatterns.reduce((sum, pattern) => sum + pattern.observationCount, 0),
    caseKeys: Array.from(new Set(matchingPatterns.flatMap((pattern) => pattern.caseKeys))),
  };
}

function functionalAlertForLine(
  line: CorpusLookupLine,
  lines: CorpusLookupLine[],
  rule: FunctionalRule,
  corpus: ObservedCorpus,
): FunctionalEquivalenceAlert | null {
  const lineText = normalize(`${line.code ?? ""} ${line.description}`);
  const sectionText = normalize(`${line.section ?? ""} ${line.subgroup ?? ""}`);
  const fullLineText = sectionAndDescription(line);
  const context = contextForCorpus(lines);
  const matchedSignals = hasAnyTerm(lineText, rule.terms);
  const sectionMatch = rule.sectionTerms ? hasAnyTerm(sectionText, rule.sectionTerms) : [];
  if (
    rule.id === "full_operating_room_scope" &&
    (/honorario/.test(sectionText) || /valor arancelario anestesico|honorario|anestesiologo|cirujano/.test(lineText))
  ) return null;
  if (rule.requiresHospitalContext && !context.hasHospital && !sectionMatch.length) return null;
  if (rule.requiresOperatingRoom && !context.hasOperatingRoom && !sectionMatch.length) return null;
  if (rule.medicationLike && !isMedicationLike(lineText, sectionText)) return null;
  if (!matchedSignals.length && !sectionMatch.length) return null;

  const lineIsHospital = HOSPITAL_CONTEXT_TERMS.some((term) => fullLineText.includes(normalize(term)));
  const lineIsOperatingRoom = OPERATING_ROOM_CONTEXT_TERMS.some((term) => fullLineText.includes(normalize(term)));
  const targetHospital = rule.targetBundles.includes("hospital_stay");
  const contextConflict = targetHospital && context.hasOperatingRoom && !lineIsHospital && !lineIsOperatingRoom;
  const observed = observedSupportForRule(rule, corpus);
  let comparability = 0.42 + Math.min(0.24, matchedSignals.length * 0.08) + (sectionMatch.length ? 0.13 : 0);
  if (targetHospital && context.hasHospital) comparability += 0.15;
  if (rule.targetBundles.includes("operating_room") && context.hasOperatingRoom) comparability += 0.15;
  if (observed.patternCount > 0) comparability += Math.min(0.07, observed.patternCount / 100);
  if (contextConflict) comparability -= 0.18;
  comparability = Math.max(0.2, Math.min(0.94, comparability));
  const alertLevel: FunctionalAlertLevel = contextConflict
    ? "context"
    : comparability >= 0.78
      ? "high"
      : comparability >= 0.56
        ? "medium"
        : "context";
  return {
    lineId: line.id ?? line.description,
    lineDescription: line.description,
    familyId: rule.id,
    familyLabel: rule.label,
    targetBundles: rule.targetBundles,
    alertLevel,
    comparability: Number(comparability.toFixed(3)),
    matchedSignals: Array.from(new Set([...matchedSignals, ...sectionMatch.map((term) => `sección: ${term}`)])),
    observedPatternCount: observed.patternCount,
    observedObservationCount: observed.observationCount,
    matchedObservedPatterns: observed.patterns.slice(0, 5).map((pattern) => `${pattern.description} (${pattern.observationCount})`),
    observedCaseKeys: observed.caseKeys,
    precedentIds: rule.precedentIds,
    sourceBasis: rule.sourceBasis,
    rationale: rule.rationale,
    evidenceToRequest: rule.evidenceToRequest,
    caution: contextConflict
      ? "El episodio también contiene anclas de pabellón; no se puede asignar esta alerta a Día Cama sin identificar lugar y momento de uso."
      : "Alerta funcional y provisional: no acredita por sí sola inclusión, cobro improcedente ni devolución.",
  };
}

/**
 * Finds functional equivalents across the complete observed account corpus.
 * This is intentionally separate from name/code equivalence: it highlights
 * the clinical function and the evidence needed to decide the billing bundle.
 */
export function findFunctionalEquivalenceAlerts(
  lines: CorpusLookupLine[],
  limitPerLine = 4,
  corpus: ObservedCorpus = OBSERVED_CHILEAN_ACCOUNT_CORPUS,
): FunctionalEquivalenceAlert[] {
  return lines.flatMap((line) => FUNCTIONAL_RULES
    .map((rule) => functionalAlertForLine(line, lines, rule, corpus))
    .filter((alert): alert is FunctionalEquivalenceAlert => alert !== null)
    .sort((left, right) => right.comparability - left.comparability)
    .slice(0, Math.max(0, limitPerLine)));
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
  corpus: ObservedCorpus = OBSERVED_CHILEAN_ACCOUNT_CORPUS,
): ObservedEquivalent[] {
  return corpus.patterns
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
