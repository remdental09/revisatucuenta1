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
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.caseCount, 7);
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.observationCount, 571);
  assert.equal(OBSERVED_CHILEAN_ACCOUNT_CORPUS.patternCount, 353);
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
