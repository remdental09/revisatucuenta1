export type StructuralBillingLine = {
  id: string;
  description: string;
  amount: number;
  code?: string;
  section?: string;
  date?: string;
  providerId?: string;
};

export type AccountStructuralSignalType =
  | "package_component_zero_value"
  | "possible_selective_itemization"
  | "opaque_adjustment"
  | "multi_entity_billing"
  | "multi_context_date_split";

export type AccountStructuralSignal = {
  id: string;
  type: AccountStructuralSignalType;
  severity: "informational" | "review" | "high";
  title: string;
  summary: string;
  lineIds: string[];
  amount: number;
  evidenceToRequest: string[];
};

const normalize = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const PACKAGE_TERMS = /\b(?:pqte|paquete|kit|bolsa|set|pack|bundle)\b/;
const ADJUSTMENT_TERMS = /\b(?:ajustes?|diferencias?|cargos?(?: adicionales?)?)\b/;

const COMPONENT_FAMILIES = [
  { id: "asepsia-curacion", terms: ["gasa", "torula", "aposito", "apósito", "tegaderm", "tela", "esponja"] },
  { id: "ropa-proteccion", terms: ["bata", "delantal", "calzon", "calzón", "sabana", "sábana", "media anti"] },
  { id: "acceso-venoso", terms: ["aguja", "jeringa", "jelco", "mariposa", "bajada", "luer", "tegaderm iv"] },
  { id: "sondas-aspiracion", terms: ["sonda", "aspiracion", "aspiración", "tubo aspiracion", "tubo aspiración"] },
];

function lineText(line: StructuralBillingLine) {
  return normalize(`${line.code ?? ""} ${line.section ?? ""} ${line.description}`);
}

function familyFor(line: StructuralBillingLine) {
  const text = lineText(line);
  return COMPONENT_FAMILIES.find((family) => family.terms.some((term) => text.includes(normalize(term))))?.id;
}

function signalId(type: AccountStructuralSignalType, suffix: string) {
  return `STRUCT-${type}-${suffix}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

/**
 * Finds accounting structure that deserves human review. These signals are
 * deliberately separate from legal inclusion candidates and never create a
 * recovery amount by themselves.
 */
export function detectAccountStructuralSignals(lines: StructuralBillingLine[]): AccountStructuralSignal[] {
  const signals: AccountStructuralSignal[] = [];
  const zeroValueLines = lines.filter((line) => line.amount === 0);
  const positiveLines = lines.filter((line) => line.amount > 0);

  for (const line of zeroValueLines) {
    const text = lineText(line);
    const packageLike = PACKAGE_TERMS.test(text);
    const componentLike = Boolean(familyFor(line));
    if (!packageLike && !componentLike) continue;
    signals.push({
      id: signalId("package_component_zero_value", line.id),
      type: "package_component_zero_value",
      severity: "informational",
      title: packageLike ? "Paquete o componente registrado sin cargo" : "Insumo registrado sin cargo",
      summary: packageLike
        ? `La glosa “${line.description}” aparece con valor cero y puede representar un paquete o componente incluido.`
        : `La glosa “${line.description}” aparece con valor cero; debe verificarse si fue incluido en una prestación principal.`,
      lineIds: [line.id],
      amount: 0,
      evidenceToRequest: [
        "Composición del paquete, bolsa o kit",
        "Registro de uso y prestación a la que se asoció",
        "Regla contractual que explica el valor cero",
      ],
    });
  }

  const familyGroups = new Map<string, StructuralBillingLine[]>();
  for (const line of lines) {
    const family = familyFor(line);
    if (family) familyGroups.set(family, [...(familyGroups.get(family) ?? []), line]);
  }
  for (const [family, familyLines] of familyGroups) {
    const zeroLines = familyLines.filter((line) => line.amount === 0);
    const chargedLines = familyLines.filter((line) => line.amount > 0);
    if (!zeroLines.length || !chargedLines.length) continue;
    const chargedAmount = chargedLines.reduce((sum, line) => sum + line.amount, 0);
    signals.push({
      id: signalId("possible_selective_itemization", family),
      type: "possible_selective_itemization",
      severity: "review",
      title: "Posible itemización selectiva por familia funcional",
      summary: `La familia “${family}” contiene líneas sin cargo y otras cobradas separadamente. El patrón requiere comparar paquetes, registro de uso y contrato.`,
      lineIds: unique([...zeroLines, ...chargedLines].map((line) => line.id)),
      amount: chargedAmount,
      evidenceToRequest: [
        "Composición de la bolsa, paquete o kit relacionado",
        "Detalle de los cargos cobrados por separado",
        "Registro clínico de uso, fecha y lugar",
        "Contrato, convenio y arancel aplicables",
      ],
    });
  }

  for (const line of positiveLines) {
    if (!ADJUSTMENT_TERMS.test(lineText(line))) continue;
    signals.push({
      id: signalId("opaque_adjustment", line.id),
      type: "opaque_adjustment",
      severity: "high",
      title: "Cargo administrativo positivo requiere desglose",
      summary: `La glosa “${line.description}” tiene un monto positivo y no describe por sí sola la prestación efectivamente realizada.`,
      lineIds: [line.id],
      amount: line.amount,
      evidenceToRequest: [
        "Desglose del ajuste y cargo original",
        "Fundamento contractual o arancelario",
        "Cuenta rectificada si corresponde",
      ],
    });
  }

  const providers = unique(lines.map((line) => line.providerId).filter(Boolean) as string[]);
  if (providers.length > 1) {
    signals.push({
      id: signalId("multi_entity_billing", providers.join("-")),
      type: "multi_entity_billing",
      severity: "review",
      title: "Cuenta emitida por más de una entidad",
      summary: `La cuenta contiene ${providers.length} entidades facturadoras; cada bloque debe conservar su total, regla y responsabilidad.`,
      lineIds: lines.map((line) => line.id),
      amount: lines.reduce((sum, line) => sum + line.amount, 0),
      evidenceToRequest: [
        "Identificación de la entidad emisora por cada línea",
        "Totales separados por empresa",
        "PAM o liquidación asociada a cada prestador",
      ],
    });
  }

  const surgicalDates = unique(lines
    .filter((line) => /pabellon|pabellón|cesarea|cesárea|anestesia|cirugia|cirugía|honorario quirurgico|honorario quirúrgico/.test(lineText(line)))
    .map((line) => line.date)
    .filter(Boolean) as string[]);
  const allDates = unique(lines.map((line) => line.date).filter(Boolean) as string[]);
  const detailLines = lines.filter((line) => /material|insumo|farmac|medicamento/.test(lineText(line)));
  if (surgicalDates.length && allDates.length > 1 && detailLines.length) {
    signals.push({
      id: signalId("multi_context_date_split", allDates.join("-")),
      type: "multi_context_date_split",
      severity: "review",
      title: "Insumos distribuidos en varias fechas del episodio",
      summary: `Hay un contexto quirúrgico y líneas de insumos en ${allDates.length} fechas. No debe asignarse todo automáticamente al pabellón.`,
      lineIds: detailLines.map((line) => line.id),
      amount: detailLines.reduce((sum, line) => sum + line.amount, 0),
      evidenceToRequest: [
        "Protocolo operatorio y fecha efectiva del procedimiento",
        "Registro de administración o consumo por fecha",
        "Lugar de uso: pabellón, recuperación o habitación",
      ],
    });
  }

  return signals;
}
