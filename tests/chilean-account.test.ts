import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  analyzeClinicalAccount,
  knowledgeFromAdjudication,
  type ChileanBillingLine,
} from "../lib/rules/chilean-account.ts";
import { POST as analyzeAccountRequest } from "../app/api/analysis/route.ts";
import { POST as registerCorpusObservationRequest } from "../app/api/corpus/route.ts";
import { POST as createCaseRequest } from "../app/api/cases/route.ts";
import { POST as updateCorpusRequest } from "../app/api/cases/[id]/corpus/route.ts";
import {
  findObservedEquivalents,
  OBSERVED_CHILEAN_ACCOUNT_CORPUS,
} from "../lib/rules/observed-corpus.ts";
import {
  analyzeInstitutionalConduct,
  APPENDICITIS_CONDUCT_EVIDENCE,
} from "../lib/rules/institutional-conduct.ts";
import {
  generateClarificationClaimMarkdown,
} from "../lib/claims/claim-generator.ts";
import {
  FULL_OPERATING_ROOM_FRAMEWORK,
  UNIVERSAL_CLAIM_LEGAL_BASIS,
} from "../lib/claims/legal-basis.ts";

test("separa conducta observable de intención no demostrada", () => {
  const findings = analyzeInstitutionalConduct(APPENDICITIS_CONDUCT_EVIDENCE);
  assert.ok(findings.some((item) => item.pattern === "question_avoidance" && item.confidence === "high"));
  assert.ok(findings.some((item) => item.pattern === "position_reversal"));
  assert.ok(findings.every((item) => !/fraude|mala fe como hecho/i.test(item.explanation)));
});

const base = {
  date: "2026-03-06",
  documentId: "3475839",
  providerId: "clinica-a",
  quantity: 1,
  page: 1,
};

test("mantiene incertidumbre explícita para artículos de hospitalización", () => {
  const lines: ChileanBillingLine[] = [
    { ...base, id: "stay", description: "Hospitalización transitoria", section: "Hospitalización transitoria", amount: 314968 },
    { ...base, id: "thermometer", description: "Termómetro digital con logo", section: "Materiales clínica", amount: 8605 },
  ];
  const result = analyzeClinicalAccount(lines);
  const candidate = result.lineAssessments.find(({ line }) => line.id === "thermometer")?.candidates[0];
  assert.equal(candidate?.bundle, "hospital_stay");
  assert.ok((candidate?.probability ?? 0) >= 0.7 && (candidate?.probability ?? 1) < 0.9);
  assert.ok(candidate?.precedentIds.includes("SUP-ARB-4063244-2025-DIACAMA-001"));
  assert.ok((candidate?.precedentSupport ?? 0) >= 0.8);
  assert.match(candidate?.missingEvidence[0] ?? "", /Contrato|convenio/);
});

test("proyecta el antecedente arbitral solo cuando el caso es materialmente comparable", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Derecho de pabellón", section: "Pabellón", amount: 900000 },
    { ...base, id: "thermometer", code: "63100133", description: "Termómetro digital", section: "Materiales clínicos", amount: 6163 },
  ]);
  const comparison = result.lineAssessments.find(({ line }) => line.id === "thermometer")?.precedentComparisons[0];
  assert.equal(comparison?.status, "partial_comparator");
  assert.ok(comparison?.distinctionFactors.some((factor) => /pabellón/i.test(factor)));
  assert.match(result.equalityProjection.projectionRule, /caso a caso/i);
});

test("conserva las cuatro conclusiones distintas de la sentencia arbitral", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "room", description: "Hospitalización pediátrica", section: "Hospitalización", amount: 120000 },
    { ...base, id: "lubricant", description: "Lubricante ocular", section: "Medicamentos hospitalizados", amount: 2500 },
    { ...base, id: "thermometer", description: "Termómetro digital", section: "Materiales clínicos", amount: 6000 },
    { ...base, id: "sleeve", description: "Mangas para compresor neumático", section: "Derecho de pabellón", amount: 18000 },
    { ...base, id: "personal", description: "Set de aseo personal adulto", section: "Materiales clínicos", amount: 3500 },
  ]);
  const lubricant = result.lineAssessments.find(({ line }) => line.id === "lubricant");
  const sleeve = result.lineAssessments.find(({ line }) => line.id === "sleeve");
  const personal = result.lineAssessments.find(({ line }) => line.id === "personal");
  assert.ok(lubricant?.candidates.some((candidate) => candidate.bundle === "hospitalized_medication"));
  assert.ok(lubricant?.precedentComparisons.some((comparison) => comparison.outcomeLabel === "Medicamentos hospitalizados"));
  assert.ok(sleeve?.precedentComparisons.some((comparison) => comparison.outcomeLabel === "Derecho de Pabellón"));
  assert.ok(personal?.precedentComparisons.some((comparison) => comparison.outcome === "excluded"));
  const isolatedPersonal = analyzeClinicalAccount([
    { ...base, id: "room", description: "Hospitalización pediátrica", section: "Hospitalización", amount: 120000 },
    { ...base, id: "personal", description: "Set de aseo personal adulto", section: "Materiales clínicos", amount: 3500 },
  ]).lineAssessments.find(({ line }) => line.id === "personal");
  assert.equal(isolatedPersonal?.candidates.length, 0);
});

test("expone expansiones jurisprudenciales como controles y no como cobertura automática", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "unknown-code", code: "00-00-000-00", description: "Fleboclisis no codificada PNA", section: "Urgencia", amount: 42000 },
    { ...base, id: "pab", description: "Derecho de pabellón", section: "Pabellón", amount: 900000 },
  ]);
  assert.ok(result.reasoningFindings.some((finding) => finding.id === "SUP-CODING-ERROR-001" && finding.status === "relevant"));
  assert.ok(result.reasoningFindings.some((finding) => finding.id === "SUP-INTEGRAL-CHARGE-001" && finding.status === "needs_evidence"));
  assert.ok(result.reasoningFindings.some((finding) => finding.id === "SUP-PROCEDURAL-CHAIN-001"));
  assert.ok(result.limitations.some((limitation) => /varias conclusiones/i.test(limitation)));
});

test("asocia el circuito de enfermería a día cama cuando no hay pabellón", () => {
  const nursingLines: ChileanBillingLine[] = [
    { ...base, id: "room", description: "HABITACION PEDIATRIA", section: "Hospitalización", amount: 529200 },
    { ...base, id: "dressing", description: "APOSITO QUIR 10 X20 ESTERIL", section: "Materiales clínicos", amount: 2136 },
    { ...base, id: "tegaderm", description: "APOSITO TEGADERM I.V", section: "Materiales clínicos", amount: 2744 },
    { ...base, id: "skin", description: "PROT. CUTANEO CUTIMED", section: "Materiales clínicos", amount: 4260 },
    { ...base, id: "remove", description: "SKIN REMOVE", section: "Materiales clínicos", amount: 1602 },
    { ...base, id: "alcohol", description: "TOALLITA C/ALCOHOL ESTERIL", section: "Materiales clínicos", amount: 92 },
    { ...base, id: "syringe", description: "JERINGA 3 ML LUER LOCK", section: "Materiales clínicos", amount: 267 },
    { ...base, id: "needle", description: "AGUJA DESECHABLE", section: "Materiales clínicos", amount: 188 },
    { ...base, id: "flebo", description: "FLEBOCLISIS", section: "Urgencia", amount: 41100 },
  ];
  const result = analyzeClinicalAccount(nursingLines);
  for (const id of ["dressing", "tegaderm", "skin", "remove", "alcohol", "syringe", "needle", "flebo"]) {
    const assessment = result.lineAssessments.find((item) => item.line.id === id);
    assert.ok(assessment?.candidates.some((candidate) => candidate.bundle === "hospital_stay"), id);
  }
  for (const id of ["syringe", "needle"]) {
    const assessment = result.lineAssessments.find((item) => item.line.id === id);
    assert.equal(assessment?.candidates.some((candidate) => candidate.bundle === "operating_room"), false, id);
  }
});

test("homologa funcionalmente insumos hospitalarios del universo observado", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "room", description: "Habitación pediátrica", section: "Hospitalización", amount: 120000 },
    { ...base, id: "jelco", description: "Catéter I.V. 24G Jelco Plus Teflón", section: "Materiales clínicos", amount: 1200 },
    { ...base, id: "dressing", description: "Apósito Tegaderm IV para catéter periférico", section: "Materiales clínicos", amount: 2500 },
    { ...base, id: "thermometer", description: "Termómetro digital flexible", section: "Materiales clínicos", amount: 6000 },
    { ...base, id: "fluid", description: "Suero fisiológico 100 ml", section: "Medicamentos y materiales", amount: 1800 },
    { ...base, id: "hygiene", description: "Paño baño seco paciente", section: "Medicamentos y materiales", amount: 900 },
  ]);
  const alertFor = (id: string) => result.lineAssessments.find((item) => item.line.id === id)?.functionalEquivalenceAlerts ?? [];
  assert.ok(alertFor("jelco").some((alert) => alert.familyId === "iv_access_and_infusion" && alert.targetBundles.includes("hospital_stay")));
  assert.ok(alertFor("dressing").some((alert) => alert.familyId === "iv_site_care"));
  assert.ok(alertFor("thermometer").some((alert) => alert.familyId === "bedside_monitoring" || alert.familyId === "general_nursing_care"));
  const fluidAlert = alertFor("fluid").find((alert) => alert.familyId === "hospitalized_medication");
  assert.ok(fluidAlert);
  assert.ok((fluidAlert?.observedObservationCount ?? 0) > 0);
  assert.ok(alertFor("hygiene").some((alert) => alert.familyId === "personal_hygiene"));
  assert.ok(result.functionalEquivalenceAlerts.every((alert) => /no acredita|provisional/i.test(alert.caution)));
});

test("homologa funcionalmente insumos de pabellón sólo cuando existe contexto quirúrgico", () => {
  const lines: ChileanBillingLine[] = [
    { ...base, id: "pab", description: "Pabellón transitorio", section: "Pabellón", amount: 900000 },
    { ...base, id: "gown", description: "Delantal estéril", section: "Materiales clínicos", amount: 5000 },
    { ...base, id: "stockings", description: "Medias antiembolismo L", section: "Materiales clínicos", amount: 8000 },
    { ...base, id: "propofol", description: "Propofol 1% 50 ml inyectable", section: "Farmacia en pabellón", amount: 12000 },
    { ...base, id: "suture", description: "Vicryl reabsorbible", section: "Materiales clínicos", amount: 9000 },
  ];
  const result = analyzeClinicalAccount(lines);
  const alerts = result.functionalEquivalenceAlerts;
  assert.ok(alerts.some((alert) => alert.lineId === "gown" && alert.familyId === "surgical_field_and_dressing" && alert.targetBundles.includes("operating_room")));
  assert.ok(alerts.some((alert) => alert.lineId === "stockings" && alert.familyId === "thromboembolic_prevention"));
  assert.ok(alerts.some((alert) => alert.lineId === "propofol" && alert.familyId === "surgical_anesthesia_and_monitoring"));
  assert.ok(alerts.some((alert) => alert.lineId === "suture" && alert.familyId === "surgical_access_and_consumables"));
  assert.ok(alerts.every((alert) => alert.observedPatternCount >= 0 && alert.precedentIds.length > 0));
  const noPavilion = analyzeClinicalAccount([
    { ...base, id: "room", description: "Hospitalización pediátrica", section: "Hospitalización", amount: 120000 },
    { ...base, id: "gown", description: "Delantal estéril", section: "Materiales clínicos", amount: 5000 },
  ]);
  assert.equal(noPavilion.functionalEquivalenceAlerts.some((alert) => alert.familyId === "surgical_field_and_dressing"), false);
});

test("aplica el alcance integral de pabellón de Circular 43 a sus categorías expresas", () => {
  const items: ChileanBillingLine[] = [
    ["glove", "GUANTE PROCEDIMIENTO ESTERIL", 1200],
    ["syringe", "JERINGA DESECHABLE 10 ML", 2900],
    ["flebo", "EQUIPO FLEBOCLISIS CON TAPA Y CONEXION", 5100],
    ["dressing", "APOSITO Y TELA ADHESIVA", 2400],
    ["aspiration", "RECEPTAL ASPIRACION", 6800],
    ["tube", "TUBO ENDOTRAQUEAL", 5288],
    ["anesthetic", "PROPOFOL 1%", 43350],
    ["suture", "SUTURA VICRYL", 9000],
    ["sutupack", "SL1324G LINO 0 SUTUPACK", 2513],
    ["humidifier", "HUMIDIFICADOR DE OXÍGENO", 3949],
  ].map(([id, description, amount]) => ({
    ...base,
    id: String(id),
    description: String(description),
    amount: Number(amount),
    section: "Materiales clínicos",
  }));
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Derecho de pabellón", section: "Pabellón", amount: 900000 },
    ...items,
  ]);

  for (const item of items) {
    const assessment = result.lineAssessments.find(({ line }) => line.id === item.id);
    const candidate = assessment?.candidates.find(({ bundle }) => bundle === "operating_room");
    assert.ok(candidate, item.description);
    assert.ok((candidate?.probability ?? 0) >= 0.84, item.description);
    assert.ok(candidate?.knowledgeIds.includes("CL-PAB-CIRCULAR43-FULL-001"), item.description);
    assert.ok(assessment?.functionalEquivalenceAlerts.some((alert) => alert.familyId === "full_operating_room_scope"), item.description);
  }
  assert.equal(result.operatingRoomFramework.version, FULL_OPERATING_ROOM_FRAMEWORK.version);
  assert.match(result.operatingRoomFramework.applicationRule, /presunción técnica/i);
});

test("no activa full pabellón sin un ancla quirúrgica", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "room", description: "Hospitalización pediátrica", section: "Hospitalización", amount: 120000 },
    { ...base, id: "syringe", description: "Jeringa desechable", section: "Materiales clínicos", amount: 900 },
  ]);
  const assessment = result.lineAssessments.find(({ line }) => line.id === "syringe");
  assert.equal(assessment?.candidates.some((candidate) => candidate.knowledgeIds.includes("CL-PAB-CIRCULAR43-FULL-001")), false);
  assert.equal(assessment?.functionalEquivalenceAlerts.some((alert) => alert.familyId === "full_operating_room_scope"), false);
});

test("distingue anestésicos incluidos de honorarios del anestesiólogo", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Derecho de pabellón", section: "Pabellón", amount: 900000 },
    { ...base, id: "drug", description: "Anestésico inhalatorio", section: "Medicamentos", amount: 12000 },
    { ...base, id: "fee", code: "2201004", description: "Valor Arancelario Anestésico", section: "Honorarios", amount: 210929 },
  ]);
  const drug = result.lineAssessments.find(({ line }) => line.id === "drug");
  const fee = result.lineAssessments.find(({ line }) => line.id === "fee");
  assert.ok(drug?.candidates.some((candidate) => candidate.knowledgeIds.includes("CL-PAB-CIRCULAR43-FULL-001")));
  assert.equal(fee?.candidates.some((candidate) => candidate.knowledgeIds.includes("CL-PAB-CIRCULAR43-FULL-001")), false);
  assert.equal(fee?.functionalEquivalenceAlerts.some((alert) => alert.familyId === "full_operating_room_scope"), false);
});

test("recupera la señal clínica aunque el nombre haya quedado pegado al código", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Pabellón transitorio", section: "Pabellón", amount: 900000 },
    { ...base, id: "stockings", code: "600513920MEDIAS", description: "ANTIEMBOLISMO L", section: "Materiales clínicos", amount: 8752 },
  ]);
  const assessment = result.lineAssessments.find(({ line }) => line.id === "stockings");
  assert.ok(assessment?.candidates.some((candidate) => candidate.bundle === "operating_room"));
  assert.ok(assessment?.functionalEquivalenceAlerts.some((alert) => alert.familyId === "full_operating_room_scope"));
});

test("asigna alta probabilidad provisional a anestésicos de pabellón", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Pabellón transitorio", section: "Pabellón transitorio", amount: 1522346 },
    { ...base, id: "propofol", description: "Propofol kit 1% 100 ml inyectable", section: "Materiales clínicos - Fármacos", amount: 43350 },
  ]);
  const candidate = result.lineAssessments.find(({ line }) => line.id === "propofol")?.candidates[0];
  assert.equal(candidate?.bundle, "operating_room");
  assert.ok((candidate?.probability ?? 0) >= 0.82);
  assert.ok(candidate?.knowledgeIds.includes("CL-PAB-ANEST-001"));
});

test("usa la prestación quirúrgica principal como ancla y no como posible fragmento", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "main", code: "311013", description: "COLECISTECTOMIA V/LAP. P", section: "PABELLON CIRUGIA 4TO PISO", amount: 1864729 },
    { ...base, id: "propofol-anchor", description: "Propofol kit 1% 100 ml inyectable", section: "PABELLON CIRUGIA 4TO PISO", amount: 43350 },
  ]);
  const procedure = result.lineAssessments.find(({ line }) => line.id === "main");
  const propofol = result.lineAssessments.find(({ line }) => line.id === "propofol-anchor");
  assert.equal(procedure?.candidates.length, 0);
  assert.ok((propofol?.candidates[0]?.probability ?? 0) >= 0.82);
});

test("incorpora sistemas perioperatorios observados en la cuenta de turbinectomía", () => {
  const observed: ChileanBillingLine[] = [
    ["kit", "KIT ANESTESIA AD 1.8M + EXT 1.2M", 37701],
    ["electrode-extension", "ALARGADOR ELECTROD.ELECTROBIST E1502", 63137],
    ["colorado", "MICROPUNTA COLORADO E1651", 21600],
    ["cleaner", "LIMPIA ELECTRODO E_2401 VALLEYLAB", 1172],
    ["plate", "PLACA VALLEYLAB E7508", 2408],
    ["pencil", "LAPIZ ELECTROBISTURI", 4552],
    ["hme", "ALARGADOR DE TUBO HME 1341011S", 5288],
    ["underbody", "COBERTOR UNDERBODY PED. BHAC 550", 22140],
    ["sleeve", "MANGA PIERNERA ANTIENB. S", 29835],
    ["stockings", "MEDIAS ANTIEMBOLISMO L", 8752],
    ["ocular", "DURATEARS UNGÜENTO OFTÁLMICO", 38803],
    ["sedline", "RD MASAC4248 SENSOR SEDLINE", 28505],
  ].map(([id, description, amount]) => ({
    ...base,
    id: String(id),
    description: String(description),
    amount: Number(amount),
    section: "Materiales clínicos",
  }));
  const result = analyzeClinicalAccount([
    { ...base, id: "anchor-pab", description: "Pabellón transitorio", section: "Pabellón transitorio", amount: 1522346 },
    ...observed,
  ]);
  const candidates = result.lineAssessments.filter((item) =>
    item.line.id !== "anchor-pab" && item.candidates.some((candidate) => candidate.probability >= 0.45),
  );
  assert.equal(candidates.length, 12);
  assert.equal(candidates.reduce((sum, item) => sum + item.line.amount, 0), 263893);
  assert.equal(result.lineAssessments.find((item) => item.line.id === "anchor-pab")?.candidates.length, 0);
  assert.ok(result.lineAssessments.find((item) => item.line.id === "plate")?.candidates.some((candidate) => candidate.knowledgeIds.includes("CL-PAB-ELECTROSURG-001")));
  assert.ok(result.lineAssessments.find((item) => item.line.id === "sedline")?.candidates.some((candidate) => candidate.knowledgeIds.includes("CL-PAB-MONITOR-001")));
});

test("aprende patrones observados en la cuenta de apendicitis sin volverlos certeza", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab-ap", description: "Derecho de pabellón", section: "Pabellón", amount: 955000 },
    { ...base, id: "syringe", description: "Jeringa desechable 10 ml", section: "Materiales clínicos", amount: 2900 },
    { ...base, id: "sponge", description: "Esponja de baño", section: "Materiales clínica", amount: 6400 },
  ]);
  const syringe = result.lineAssessments.find(({ line }) => line.id === "syringe")?.candidates[0];
  const sponge = result.lineAssessments.find(({ line }) => line.id === "sponge")?.candidates[0];
  assert.equal(syringe?.bundle, "operating_room");
  assert.ok((syringe?.probability ?? 0) >= 0.78);
  assert.equal(sponge?.bundle, "hospital_stay");
  assert.ok((sponge?.probability ?? 1) < 0.7);
});

test("detecta duplicados exactos, valores cero y ajustes opacos", () => {
  const lines: ChileanBillingLine[] = [
    { ...base, id: "lidocaine-1", code: "500530849", description: "RME Lidocaína 100 mg 5 ml", amount: 1688, unitAmount: 1688 },
    { ...base, id: "lidocaine-2", code: "500530849", description: "RME Lidocaína 100 mg 5 ml", amount: 1688, unitAmount: 1688 },
    { ...base, id: "gown", code: "600620014", description: "Bata quirúrgica", amount: 0 },
    { ...base, id: "adjustment", code: "0299999", description: "Ajustes hospitalización", section: "Varios exento", amount: 134131 },
  ];
  const anomalies = analyzeClinicalAccount(lines).anomalies;
  assert.ok(anomalies.some((item) => item.type === "exact_duplicate_candidate"));
  assert.ok(anomalies.some((item) => item.type === "zero_value_inclusion_marker"));
  assert.ok(anomalies.some((item) => item.type === "opaque_adjustment"));
});

test("no confunde roles o factores quirúrgicos con duplicidad", () => {
  const lines: ChileanBillingLine[] = [
    { ...base, id: "surgeon", code: "1302052", description: "Rinoplastia y/o septoplastia", amount: 1927021, professionalId: "p1", professionalRole: "cirujano", factor: 1 },
    { ...base, id: "assistant", code: "1302052", description: "Rinoplastia y/o septoplastia", amount: 481755, professionalId: "p2", professionalRole: "ayudante", factor: 0.25 },
  ];
  const anomalies = analyzeClinicalAccount(lines).anomalies;
  assert.equal(anomalies.some((item) => item.type === "exact_duplicate_candidate"), false);
  assert.ok(anomalies.some((item) => item.type === "simultaneous_procedure_factor"));
});

test("convierte una resolución revisada en conocimiento confirmado", () => {
  const entry = knowledgeFromAdjudication({
    id: "SUP-TERM-001",
    label: "Termómetro incluido en hospitalización",
    terms: ["termómetro"],
    bundle: "hospital_stay",
    outcome: "included",
    authority: "regulator_decision",
    sourceReference: "Resolución revisada, rol de ejemplo",
    scope: "contract_specific",
  });
  assert.equal(entry.status, "confirmed");
  assert.equal(entry.probability, 0.96);
  assert.equal(entry.authority, "regulator_decision");
});

test("expone el motor para las próximas cuentas con trazabilidad de página", async () => {
  const response = await analyzeAccountRequest(
    new Request("http://localhost/api/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lines: [
          { ...base, id: "needle", description: "Aguja desechable", section: "Materiales clínicos", amount: 1200 },
        ],
      }),
    }),
  );
  assert.equal(response.status, 200);
  const analysis = await response.json() as { version: string; claimFramework: { legalBasis: string; appliesTo: string }; lineAssessments: Array<{ line: ChileanBillingLine }> };
  assert.equal(analysis.version, "cl-account-v6");
  assert.equal(analysis.claimFramework.legalBasis, UNIVERSAL_CLAIM_LEGAL_BASIS);
  assert.equal(analysis.claimFramework.appliesTo, "all_items_and_categories");
  assert.equal(analysis.lineAssessments[0]?.line.page, 1);
});

test("detecta paquetes, valores cero, itemización selectiva y ajustes plurales", () => {
  const result = analyzeClinicalAccount([
    { ...base, id: "pab", description: "Derecho de pabellón", section: "Pabellón", amount: 900000, date: "2026-03-06", providerId: "clinica-a" },
    { ...base, id: "package", description: "PQTE CESAREA", section: "Materiales clínicos", amount: 0, date: "2026-03-06", providerId: "clinica-a" },
    { ...base, id: "gauze-zero", description: "Gasa estéril", section: "Materiales clínicos", amount: 0, date: "2026-03-06", providerId: "clinica-a" },
    { ...base, id: "dressing", description: "Apósito estéril", section: "Materiales clínicos", amount: 2400, date: "2026-03-07", providerId: "clinica-a" },
    { ...base, id: "adjustment", description: "AJUSTES HOSPITALIZACION", section: "Hospitalización", amount: 142929, date: "2026-03-06", providerId: "clinica-a" },
    { ...base, id: "second-provider", description: "Honorario quirúrgico", section: "Honorarios", amount: 12000, date: "2026-03-06", providerId: "servicios-b" },
  ]);
  assert.ok(result.accountSignals.some((signal) => signal.type === "package_component_zero_value"));
  assert.ok(result.accountSignals.some((signal) => signal.type === "possible_selective_itemization"));
  assert.ok(result.accountSignals.some((signal) => signal.type === "opaque_adjustment" && signal.amount === 142929));
  assert.ok(result.accountSignals.some((signal) => signal.type === "multi_entity_billing"));
  assert.ok(result.accountSignals.some((signal) => signal.type === "multi_context_date_split"));
  assert.ok(result.anomalies.some((anomaly) => anomaly.type === "opaque_adjustment" && anomaly.lineIds.includes("adjustment")));
});

test("el generador aplica el fundamento común a cualquier ítem o rubro", () => {
  const draft = generateClarificationClaimMarkdown({
    caseId: "caso-prueba",
    patientName: "Paciente de prueba",
    episodeLabel: "Laboratorio y medicamentos",
    analysis: analyzeClinicalAccount([
      { ...base, id: "lab", description: "Hemograma", section: "Laboratorio clínico", amount: 12000 },
      { ...base, id: "material", description: "Jeringa descartable", section: "Materiales clínicos", amount: 800 },
    ]),
  });
  assert.match(draft, /Fundamento común aplicable a cualquier ítem o rubro/);
  assert.match(draft, new RegExp(UNIVERSAL_CLAIM_LEGAL_BASIS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(draft, /Laboratorio y medicamentos/);
  assert.match(draft, /Alcance integral del Derecho de Pabellón/);
  assert.match(draft, /insumos desechables o recuperables/);
});

test("carga el corpus desidentificado de todas las cuentas revisadas", () => {
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount, 13);
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.observationCount, 1468);
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.patternCount, 664);
  assert.match(OBSERVED_CHILEAN_ACCOUNT_CORPUS.privacy, /no contiene nombres/i);
});

test("reconoce un insumo ya visto aunque llegue con una glosa parecida", () => {
  const matches = findObservedEquivalents({
    description: "Jeringa descartable 5 ml Luerlock",
  });
  assert.ok(matches.length > 0);
  assert.ok(matches[0]!.equivalenceProbability >= 0.65);
  assert.match(matches[0]!.description, /jeringa/i);
});

test("usa el código interno como evidencia fuerte de equivalencia", () => {
  const matches = findObservedEquivalents({
    code: "600510115",
    description: "Termómetro clínico flexible",
  });
  assert.equal(matches[0]?.matchBasis, "same_item_code");
  assert.equal(matches[0]?.equivalenceProbability, 0.97);
});

test("la repetición histórica no se convierte sola en fragmentación", () => {
  const analysis = analyzeClinicalAccount([
    {
      ...base,
      id: "electrolyte",
      code: "811998",
      description: "Electrolitos plasmáticos cloro",
      section: "Laboratorio clínico",
      amount: 14770,
    },
  ]);
  assert.ok(analysis.lineAssessments[0]!.observedEquivalents.length > 0);
  assert.equal(analysis.lineAssessments[0]!.candidates.length, 0);
});

test("incorpora cuentas nuevas al corpus sólo después de validarlas", async () => {
  const caseId = `corpus-test-${randomUUID()}`;
  const created = await createCaseRequest(new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: caseId, episodeLabel: "Hospitalización pediátrica" }),
  }));
  assert.equal(created.status, 201);

  const requestBody = {
    caseId,
    episodeLabel: "Hospitalización pediátrica",
    lines: [{ id: "new-item", description: "Termómetro incremental de prueba", amount: 100, page: 1, section: "Materiales clínicos" }],
  };
  const firstAnalysis = await analyzeAccountRequest(new Request("http://localhost/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  }));
  const firstPayload = await firstAnalysis.json() as { corpusLearning?: { status: string }; observedCorpus: { caseCount: number } };
  assert.equal(firstAnalysis.status, 200);
  assert.equal(firstPayload.corpusLearning?.status, "pending_review");
  assert.equal(firstPayload.observedCorpus.caseCount, OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount);

  const validated = await updateCorpusRequest(new Request(`http://localhost/api/cases/${caseId}/corpus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "validated" }),
  }), { params: Promise.resolve({ id: caseId }) });
  const validatedPayload = await validated.json() as { activeInCorpus: boolean; caseCount: number };
  assert.equal(validated.status, 200);
  assert.equal(validatedPayload.activeInCorpus, true);
  assert.equal(validatedPayload.caseCount, OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount + 1);

  const secondAnalysis = await analyzeAccountRequest(new Request("http://localhost/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  }));
  const secondPayload = await secondAnalysis.json() as { observedCorpus: { caseCount: number; observationCount: number }; lineAssessments: Array<{ observedEquivalents: Array<{ description: string }> }> };
  assert.equal(secondPayload.observedCorpus.caseCount, OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount + 1);
  assert.equal(secondPayload.observedCorpus.observationCount, OBSERVED_CHILEAN_ACCOUNT_CORPUS.observationCount + 1);
  assert.equal(secondPayload.lineAssessments[0]?.observedEquivalents[0]?.description, "Termómetro incremental de prueba");
});

test("acumula cuenta y PAM en una observación pendiente antes de activar el corpus", async () => {
  const caseId = `account-pam-corpus-${randomUUID()}`;
  const created = await createCaseRequest(new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: caseId, episodeLabel: "Cuenta y PAM" }),
  }));
  assert.equal(created.status, 201);

  const account = await registerCorpusObservationRequest(new Request("http://localhost/api/corpus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId,
      sourceKind: "account",
      sourceDocumentId: "account-doc",
      lines: [{ id: "account-line", description: "Apósito estéril", amount: 1200, page: 1, section: "Materiales clínicos" }],
    }),
  }));
  assert.equal(account.status, 200);
  assert.equal((await account.json()).status, "pending_review");

  const pam = await registerCorpusObservationRequest(new Request("http://localhost/api/corpus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId,
      sourceKind: "pam",
      sourceDocumentId: "pam-doc",
      lines: [{ id: "pam-line", description: "Prestación hospitalaria", amount: 1200, page: 1, section: "PAM" }],
    }),
  }));
  const pamPayload = await pam.json() as { status: string; activeInCorpus: boolean };
  assert.equal(pam.status, 200);
  assert.equal(pamPayload.status, "pending_review");
  assert.equal(pamPayload.activeInCorpus, false);

  const validated = await updateCorpusRequest(new Request(`http://localhost/api/cases/${caseId}/corpus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "validated" }),
  }), { params: Promise.resolve({ id: caseId }) });
  assert.equal(validated.status, 200);
  assert.equal((await validated.json()).activeInCorpus, true);
});
