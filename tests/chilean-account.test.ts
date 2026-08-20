import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeClinicalAccount,
  knowledgeFromAdjudication,
  type ChileanBillingLine,
} from "../lib/rules/chilean-account.ts";
import { POST as analyzeAccountRequest } from "../app/api/analysis/route.ts";
import {
  findObservedEquivalents,
  OBSERVED_CHILEAN_ACCOUNT_CORPUS,
} from "../lib/rules/observed-corpus.ts";
import {
  analyzeInstitutionalConduct,
  APPENDICITIS_CONDUCT_EVIDENCE,
} from "../lib/rules/institutional-conduct.ts";

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
  assert.ok((candidate?.probability ?? 0) > 0.3 && (candidate?.probability ?? 1) < 0.7);
  assert.match(candidate?.missingEvidence[0] ?? "", /Contrato|convenio/);
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
  const analysis = await response.json() as { version: string; lineAssessments: Array<{ line: ChileanBillingLine }> };
  assert.equal(analysis.version, "cl-account-v1");
  assert.equal(analysis.lineAssessments[0]?.line.page, 1);
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
