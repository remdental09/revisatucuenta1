export type ConductEvidence = {
  id: string;
  actor: "patient" | "provider" | "insurer" | "regulator";
  kind:
    | "specific_question"
    | "generic_answer"
    | "denial"
    | "external_correction"
    | "late_correction"
    | "burden_shift"
    | "reassuring_language";
  description: string;
  source: string;
};

export type ConductFinding = {
  pattern: "question_avoidance" | "friction_asymmetry" | "reassurance_gap" | "position_reversal";
  confidence: "moderate" | "high";
  title: string;
  explanation: string;
  evidenceIds: string[];
  humanEffect: string;
};

/**
 * Evaluates observable institutional conduct. It never diagnoses a person or
 * treats intent, fraud or bad faith as proven merely from an adverse outcome.
 */
export function analyzeInstitutionalConduct(evidence: ConductEvidence[]): ConductFinding[] {
  const has = (kind: ConductEvidence["kind"]) => evidence.some((item) => item.kind === kind);
  const ids = (...kinds: ConductEvidence["kind"][]) =>
    evidence.filter((item) => kinds.includes(item.kind)).map((item) => item.id);
  const findings: ConductFinding[] = [];

  if (has("specific_question") && has("generic_answer")) {
    findings.push({
      pattern: "question_avoidance",
      confidence: "high",
      title: "La respuesta no resuelve la pregunta concreta",
      explanation:
        "Se pidió identificar la pertenencia contractual de cobros específicos, pero la respuesta se apoyó en categorías generales sin realizar esa asignación ítem por ítem.",
      evidenceIds: ids("specific_question", "generic_answer"),
      humanEffect:
        "La persona recibe mucha explicación formal, pero sigue sin saber qué debe aceptar, objetar o comparar con su contrato.",
    });
  }

  if (has("denial") && has("external_correction")) {
    findings.push({
      pattern: "position_reversal",
      confidence: "high",
      title: "La posición inicial fue contradicha por el resultado posterior",
      explanation:
        "La aseguradora sostuvo que la liquidación era correcta y solicitó rechazar el reclamo; posteriormente, el tribunal ordenó reagrupar y bonificar varios de los conceptos discutidos.",
      evidenceIds: ids("denial", "external_correction", "late_correction"),
      humanEffect:
        "Sin conocimiento técnico y persistencia, un usuario razonable podría abandonar antes de obtener la corrección.",
    });
  }

  if (has("burden_shift") && has("late_correction")) {
    findings.push({
      pattern: "friction_asymmetry",
      confidence: "moderate",
      title: "La carga de aclarar y corregir recayó en el paciente",
      explanation:
        "La institución controlaba códigos, aranceles y liquidación, pero la corrección apareció después de reclamos y escalamiento, trasladando tiempo, comprensión y seguimiento al usuario.",
      evidenceIds: ids("burden_shift", "late_correction"),
      humanEffect:
        "La fatiga, la urgencia económica y la autoridad técnica de la institución aumentan la probabilidad de que el cobro pase sin revisión.",
    });
  }

  if (has("reassuring_language") && has("denial")) {
    findings.push({
      pattern: "reassurance_gap",
      confidence: "moderate",
      title: "Existe una brecha entre el tono tranquilizador y la decisión sustantiva",
      explanation:
        "La comunicación ofrece empatía, certeza y transparencia, pero simultáneamente mantiene la negativa sin contestar la clasificación contractual solicitada.",
      evidenceIds: ids("reassuring_language", "denial"),
      humanEffect:
        "El tono puede reducir la disposición a insistir, aunque el problema material permanezca sin resolver.",
    });
  }

  return findings;
}

export const APPENDICITIS_CONDUCT_EVIDENCE: ConductEvidence[] = [
  { id: "request-item-basis", actor: "patient", kind: "specific_question", description: "Se solicitó aclarar y bonificar prestaciones concretas del episodio.", source: "Reclamo del afiliado y demanda arbitral, rol 4063244-2025" },
  { id: "generic-plan-answer", actor: "insurer", kind: "generic_answer", description: "La respuesta invocó porcentajes, topes y categorías generales sin asignar cada patrón al día cama o pabellón.", source: "Respuesta Isapre de 2 de abril de 2026" },
  { id: "correctness-denial", actor: "insurer", kind: "denial", description: "La Isapre afirmó haber aplicado correctamente el plan y pidió rechazar la demanda.", source: "Respuesta Isapre y contestación resumida en sentencia" },
  { id: "friendly-certainty", actor: "insurer", kind: "reassuring_language", description: "La carta ofrece empatía, absoluta certeza, transparencia y claridad mientras mantiene la negativa.", source: "Respuesta Isapre de 2 de abril de 2026" },
  { id: "patient-must-escalate", actor: "insurer", kind: "burden_shift", description: "El paciente debió identificar códigos, reclamar y acudir al tribunal para obtener una clasificación precisa.", source: "Secuencia documental del expediente" },
  { id: "tribunal-reclassification", actor: "regulator", kind: "external_correction", description: "El tribunal asignó termómetro, vía venosa y fleboclisis al día cama; medias y otros insumos al pabellón; lubricante a medicamentos.", source: "Sentencia de 15 de abril de 2026, considerando 7" },
  { id: "post-ruling-pam", actor: "insurer", kind: "late_correction", description: "La reliquidación posterior otorgó cobertura a rubros previamente discutidos.", source: "PAM adjunto a la respuesta de cumplimiento incorporada en junio de 2026" },
];

export const APPENDICITIS_CONDUCT_FINDINGS = analyzeInstitutionalConduct(
  APPENDICITIS_CONDUCT_EVIDENCE,
);
