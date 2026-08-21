export const UNIVERSAL_CLAIM_LEGAL_BASIS =
  "Conforme a los artículos 8, 11, 31 y 32 de la Ley N.º 20.584, solicito información suficiente, oportuna, veraz y comprensible sobre las prestaciones otorgadas, sus valores, tarifas aplicadas, medicamentos, materiales e insumos utilizados, así como una cuenta actualizada y pormenorizada de los gastos efectivamente incurridos. Asimismo, solicito informar la composición del cargo “Habitación Pediatría” y el fundamento por el cual determinados conceptos fueron incluidos o facturados separadamente.";

export type ClaimFramework = {
  version: "claim-basis-v1";
  appliesTo: "all_items_and_categories";
  legalBasis: string;
  articles: ["8", "11", "31", "32"];
  usageNote: string;
};

export type EqualityProjectionFramework = {
  version: "equality-projection-v1";
  constitutionalBasis: string;
  precedentRole: string;
  projectionRule: string;
  comparisonFactors: string[];
  requiredEvidence: string[];
  limits: string[];
};

export type OperatingRoomFramework = {
  version: "operating-room-scope-v1";
  sourceRule: string;
  sourceReferences: string[];
  includedCategories: string[];
  expressDistinctions: string[];
  applicationRule: string;
  requiredEvidence: string[];
  limits: string[];
};

export const UNIVERSAL_CLAIM_FRAMEWORK: ClaimFramework = {
  version: "claim-basis-v1",
  appliesTo: "all_items_and_categories",
  legalBasis: UNIVERSAL_CLAIM_LEGAL_BASIS,
  articles: ["8", "11", "31", "32"],
  usageNote:
    "Se incorpora como fundamento común de toda solicitud de aclaración o reclamo, sin depender del ítem, prestación, medicamento, material o rubro analizado.",
};

/**
 * Marco de proyección controlada: permite reutilizar un criterio arbitral
 * cuando el nuevo expediente es materialmente comparable, sin convertir una
 * decisión de un caso concreto en una regla universal de cobertura.
 */
export const EQUALITY_PROJECTION_FRAMEWORK: EqualityProjectionFramework = {
  version: "equality-projection-v1",
  constitutionalBasis:
    "Artículo 19 N.º 2 de la Constitución Política: igualdad ante la ley y prohibición de diferencias arbitrarias.",
  precedentRole:
    "Una sentencia arbitral es un antecedente comparable y persuasivo. Sirve para pedir un trato coherente y una explicación objetiva si se adopta un criterio distinto.",
  projectionRule:
    "La proyección solo se activa caso a caso cuando el ítem, su función, el episodio, la forma de cobro y el marco contractual presentan equivalencia material suficiente.",
  comparisonFactors: [
    "Identidad o equivalencia del insumo, glosa y código.",
    "Mismo tipo de episodio y contexto clínico.",
    "Misma función dentro de la atención y del cuidado de enfermería.",
    "Cobro separado del cargo principal comparable.",
    "Contrato, plan, convenio y arancel aplicados.",
    "Registro de uso, administración o consumo efectivo.",
  ],
  requiredEvidence: [
    "Cuenta clínica pormenorizada y página de origen.",
    "Contrato, plan, convenio o arancel aplicable.",
    "Registro clínico o de uso del insumo.",
    "Respuesta del prestador y de la Isapre.",
    "Diferencias objetivas que puedan justificar apartarse del antecedente.",
  ],
  limits: [
    "La igualdad no elimina las diferencias relevantes entre contratos, planes o episodios.",
    "La comparación no acredita por sí sola una devolución ni una cobertura automática.",
    "La homologación y la decisión final corresponden a la autoridad competente.",
  ],
};

/**
 * Alcance técnico amplio del Derecho de Pabellón. La regla abre una
 * presunción de revisión cuando existe un pabellón real; no decide por sí sola
 * la cobertura contractual ni ordena una devolución.
 */
export const FULL_OPERATING_ROOM_FRAMEWORK: OperatingRoomFramework = {
  version: "operating-room-scope-v1",
  sourceRule:
    "El Derecho de Pabellón o Quirófano comprende la sala de operaciones y sus anexos, incluida la recuperación postanestésica; muebles, equipos y elementos no fungibles; insumos, implementos y útiles fungibles desechables, recuperables y de uso general; gases; y anestésicos de cualquier tipo.",
  sourceReferences: [
    "Circular N.º 43 y Apéndice del Anexo N.º 4 sobre Derecho de Pabellón",
    "Compendio de Procedimientos de la Superintendencia de Salud, Capítulo II, Apéndice del Anexo N.º 4, pp. 113-116",
    "Tribunal Arbitral de la Superintendencia de Salud, Rol 4063244-2025, considerando 7",
    "Jurisprudencia SIS sobre integralidad, codificación, exclusiones e información al beneficiario",
  ],
  includedCategories: [
    "Sala de operaciones, anexos y recuperación postanestésica.",
    "Muebles, instrumental, iluminación, climatización y elementos no fungibles.",
    "Aspiración, oxígeno, anestesia, intubación, monitorización, resucitación y sus conexiones o accesorios.",
    "Electrobisturí o láser, microscopía, videolaparoscopía, endoscopía y ventilación mecánica.",
    "Hojas de bisturí, catéteres corrientes, ropa de intervención, jeringas, agujas, fleboclisis y todos sus accesorios.",
    "Guantes, drenajes, cánulas, sondas, paños, uniformes, gasas, algodón, tórulas, apósitos y telas adhesivas.",
    "Antisépticos, desinfectantes, formalina, jabones y escobillas para lavado quirúrgico, y todo tipo de material de sutura.",
    "Oxígeno, aire comprimido y anestésicos de cualquier tipo.",
  ],
  expressDistinctions: [
    "La mención al equipo de Rayos X excluye expresamente los medios de contraste y las placas.",
    "Prótesis, implantes y materiales especiales no quedan decididos sólo por semejanza: requieren arancel, convenio y registro de uso.",
    "Un medicamento no anestésico conserva una clasificación propia salvo que su función perioperatoria y el instrumento aplicable justifiquen otra conclusión.",
  ],
  applicationRule:
    "Confirmado un pabellón real, todo cargo separado que encaje en estas categorías activa una presunción técnica de inclusión para revisión. La institución debe identificar la diferencia objetiva, el código, el registro de uso y la regla contractual que autorizarían tratarlo como cobro separable.",
  requiredEvidence: [
    "Protocolo operatorio y hoja de anestesia.",
    "Registro de pabellón, recuperación y consumo efectivo.",
    "Código de la intervención principal y del cargo separado.",
    "Contrato, plan, convenio y arancel vigentes para el episodio.",
    "PAM o liquidación y respuesta fundada del prestador y de la Isapre.",
  ],
  limits: [
    "Sin ancla de pabellón no se proyecta esta regla al episodio.",
    "La alerta no acredita por sí sola cobro improcedente, cobertura ni devolución.",
    "La conclusión final es caso a caso y puede ser confirmada o descartada por la Superintendencia de Salud.",
  ],
};
