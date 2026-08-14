export type RuleVerdict =
  | "candidate"
  | "cleared"
  | "not_evaluable"
  | "informational";

export type ChargeLine = {
  id: string;
  description: string;
  amount: number;
  page: number;
  context: "room" | "operating_room" | "professional" | "other";
};

export type RuleSource = {
  label: string;
  url: string;
  section: string;
  scope: "general" | "fonasa_mle" | "isapre_liquidation";
};

export type BundleRule = {
  id: string;
  family: "bundling" | "duplicate" | "temporal" | "transparency";
  title: string;
  description: string;
  parentContext?: ChargeLine["context"];
  childTerms?: string[];
  requiresContractForConclusion: boolean;
  source: RuleSource;
};

export type CaseRuleContext = {
  financing: "fonasa_mle" | "isapre_conventional" | "unknown";
  hasContract: boolean;
  hasPayerDuplicateStatement: boolean;
  payerDuplicateAmount: number;
  admission: string;
  discharge: string;
  chargedLines: ChargeLine[];
};

export type RuleEvaluation = {
  ruleId: string;
  title: string;
  verdict: RuleVerdict;
  explanation: string;
  matchedLines: ChargeLine[];
  amount: number | null;
  source: RuleSource;
  missingEvidence?: string;
};

export const RULE_SOURCES = {
  nta277: {
    label: "Resolución Exenta N°277/2011, texto actualizado",
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1026208",
    section: "Punto 26, letras d), e), f) y g)",
    scope: "fonasa_mle" as const,
  },
  circular319: {
    label: "Circular IF/N°319",
    url: "https://www.superdesalud.gob.cl/app/uploads/2018/11/articles-17656_Texto_refundido.pdf",
    section: "Información mínima de liquidaciones Isapre",
    scope: "isapre_liquidation" as const,
  },
  rights: {
    label: "Ley N°20.584, información financiera",
    url: "https://www.superdesalud.gob.cl/tax-materias-prestadores/ley-de-derechos-y-deberes-4185/",
    section: "Cuenta detallada, medicamentos e insumos",
    scope: "general" as const,
  },
};

export const UNBUNDLING_RULES: BundleRule[] = [
  {
    id: "UB-PAB-001",
    family: "bundling",
    title: "Elementos potencialmente incluidos en derecho de pabellón",
    description:
      "Busca líneas cobradas en pabellón que coinciden con la lista de insumos y elementos incluidos por la NTA MLE.",
    parentContext: "operating_room",
    childTerms: [
      "jeringa",
      "aguja",
      "equipo fleboclisis",
      "canula",
      "sonda aspiracion",
      "medias antiembolicas",
      "delantal esteril",
      "sabana de mesa",
      "surgitie",
      "vicryl",
    ],
    requiresContractForConclusion: true,
    source: RULE_SOURCES.nta277,
  },
  {
    id: "UB-PAB-002",
    family: "bundling",
    title: "Medicamentos anestésicos potencialmente incluidos",
    description:
      "La NTA MLE incluye anestésicos y medicación anestésica habitual; la clasificación clínica de cada fármaco debe validarse.",
    parentContext: "operating_room",
    childTerms: [
      "sevoflurano",
      "rocuronio",
      "succinil colina",
      "propofol",
      "bupivacaina",
      "lidocaina",
      "sugammadex",
      "atropina",
    ],
    requiresContractForConclusion: true,
    source: RULE_SOURCES.nta277,
  },
  {
    id: "DUP-PAM-001",
    family: "duplicate",
    title: "Duplicación informada por la Isapre",
    description:
      "Lee el certificado o sección de cobros duplicados del PAM sin reemplazar una revisión independiente.",
    requiresContractForConclusion: false,
    source: RULE_SOURCES.circular319,
  },
  {
    id: "TMP-CAMA-001",
    family: "temporal",
    title: "Condición temporal del día cama",
    description:
      "Contrasta ingreso y alta para verificar pernoctación cuando el código corresponde a día cama integral.",
    requiresContractForConclusion: false,
    source: RULE_SOURCES.nta277,
  },
  {
    id: "DOC-DET-001",
    family: "transparency",
    title: "Trazabilidad de unidades efectivamente usadas",
    description:
      "Exige que cada monto cuestionado conserve descripción, cantidad, precio y página de origen.",
    requiresContractForConclusion: false,
    source: RULE_SOURCES.rights,
  },
];

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function evaluateUnbundlingRules(
  context: CaseRuleContext,
): RuleEvaluation[] {
  return UNBUNDLING_RULES.map((rule) => {
    if (rule.id === "DUP-PAM-001") {
      return {
        ruleId: rule.id,
        title: rule.title,
        verdict:
          context.hasPayerDuplicateStatement &&
          context.payerDuplicateAmount === 0
            ? "informational"
            : "candidate",
        explanation: context.hasPayerDuplicateStatement
          ? `La Isapre informó $${context.payerDuplicateAmount.toLocaleString("es-CL")} como cobros duplicados según su norma técnica. Esto no descarta unbundling no detectado por esa liquidación.`
          : "No se encontró una declaración del pagador sobre cobros duplicados.",
        matchedLines: [],
        amount: context.hasPayerDuplicateStatement
          ? context.payerDuplicateAmount
          : null,
        source: rule.source,
      };
    }

    if (rule.id === "TMP-CAMA-001") {
      const admission = new Date(context.admission);
      const discharge = new Date(context.discharge);
      const crossedMidnight =
        admission.toDateString() !== discharge.toDateString();
      const roomLines = context.chargedLines.filter(
        (line) => line.context === "room",
      );
      return {
        ruleId: rule.id,
        title: rule.title,
        verdict: crossedMidnight ? "cleared" : "candidate",
        explanation: crossedMidnight
          ? "El episodio cruza la medianoche; no se genera indicio temporal contra el día cama integral."
          : "No se observó pernoctación y el tipo exacto de día cama debe verificarse.",
        matchedLines: roomLines,
        amount: roomLines.reduce((sum, line) => sum + line.amount, 0),
        source: rule.source,
      };
    }

    if (rule.id === "DOC-DET-001") {
      return {
        ruleId: rule.id,
        title: rule.title,
        verdict: context.chargedLines.every(
          (line) => line.page > 0 && line.amount >= 0,
        )
          ? "cleared"
          : "not_evaluable",
        explanation:
          "Las líneas usadas por el motor conservan monto, contexto y página del documento original.",
        matchedLines: context.chargedLines,
        amount: null,
        source: rule.source,
      };
    }

    const terms = rule.childTerms ?? [];
    const matchedLines = context.chargedLines.filter(
      (line) =>
        line.context === rule.parentContext &&
        terms.some((term) => normalize(line.description).includes(term)),
    );
    const amount = matchedLines.reduce((sum, line) => sum + line.amount, 0);
    const contractMissing =
      rule.requiresContractForConclusion &&
      context.financing === "isapre_conventional" &&
      !context.hasContract;

    return {
      ruleId: rule.id,
      title: rule.title,
      verdict: matchedLines.length ? "candidate" : "cleared",
      explanation: matchedLines.length
        ? `${matchedLines.length} líneas coinciden con la regla de inclusión. ${contractMissing ? "La coincidencia es un indicio: falta probar que la regla MLE integra el convenio Isapre aplicable." : "La regla puede contrastarse con el instrumento financiero aplicable."}`
        : "No se encontraron coincidencias en las líneas disponibles.",
      matchedLines,
      amount,
      source: rule.source,
      missingEvidence: contractMissing
        ? "Contrato del plan y convenio/arancel aplicado por el prestador"
        : undefined,
    };
  });
}

export const EMBLEMATIC_CHARGES: ChargeLine[] = [
  {
    id: "room-1",
    description: "Día cama individual",
    amount: 452075,
    page: 1,
    context: "room",
  },
  {
    id: "or-1",
    description: "Jeringa 3 cc embutida",
    amount: 964,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-2",
    description: "Aguja desechable 18G",
    amount: 261,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-3",
    description: "Equipo fleboclisis",
    amount: 729,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-4",
    description: "Jeringa 5 cc embutida",
    amount: 752,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-5",
    description: "Jeringa 10 cc embutida",
    amount: 2105,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-6",
    description: "Jeringa 20 cc embutida",
    amount: 3714,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-7",
    description: "Cánula Mayo",
    amount: 2054,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-8",
    description: "Cánula endotraqueal",
    amount: 4929,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-9",
    description: "Sonda aspiración N°16",
    amount: 1094,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-10",
    description: "Medias antiembólicas",
    amount: 34768,
    page: 2,
    context: "operating_room",
  },
  {
    id: "or-11",
    description: "Delantal estéril",
    amount: 29686,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-12",
    description: "Sábana de mesa quirúrgica",
    amount: 7278,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-13",
    description: "Surgitie Polysorb",
    amount: 127726,
    page: 1,
    context: "operating_room",
  },
  {
    id: "or-14",
    description: "Vicryl",
    amount: 5683,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-1",
    description: "Sevoflurano",
    amount: 177680,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-2",
    description: "Rocuronio",
    amount: 33042,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-3",
    description: "Succinil colina",
    amount: 4853,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-4",
    description: "Propofol",
    amount: 27168,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-5",
    description: "Bupivacaína",
    amount: 15820,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-6",
    description: "Lidocaína",
    amount: 721,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-7",
    description: "Sugammadex",
    amount: 240713,
    page: 2,
    context: "operating_room",
  },
  {
    id: "med-8",
    description: "Atropina",
    amount: 862,
    page: 2,
    context: "operating_room",
  },
];

export function evaluateEmblematicCase(hasContract = false) {
  return evaluateUnbundlingRules({
    financing: "isapre_conventional",
    hasContract,
    hasPayerDuplicateStatement: true,
    payerDuplicateAmount: 0,
    admission: "2025-07-06T13:50:00-04:00",
    discharge: "2025-07-07T11:36:00-04:00",
    chargedLines: EMBLEMATIC_CHARGES,
  });
}
