import assert from "node:assert/strict";
import test from "node:test";
import { buildReaderAssistContext, parseReaderAssistResponse, requestReaderAssist } from "../lib/server/openai-reader-assist.ts";
import { parseAnalysisAssistResponse, requestAnalysisAssist } from "../lib/server/openai-analysis-assist.ts";
import { isVisionPageImage, requestVisionAssist } from "../lib/server/openai-vision-assist.ts";
import { analyzeClinicalAccount, type ChileanBillingLine } from "../lib/rules/chilean-account.ts";
import type { DocumentExtraction, VisionPageImage } from "../lib/extraction/types.ts";

function sampleExtraction(): DocumentExtraction {
  return {
    pageCount: 2,
    usedOcr: true,
    ocrPages: [1],
    readerAssessment: {
      status: "reader_change_needed",
      parserMode: "mixed",
      confidence: 0.62,
      templateFingerprint: "shape-test",
      unknownItems: [],
      numericIssues: [],
      lowConfidencePages: [1],
      signals: ["Formato nuevo"],
      nextAction: "Revisar",
      codeChangeNeeded: true,
      llmAssist: { status: "not_attempted", role: "assistive_only", contractVersion: "reader-change-v1" },
    },
    account: {
      type: "account",
      label: "Cuenta clínica",
      pages: [1, 2],
      fields: [
        { key: "patient", label: "Paciente", value: "PERSONA PRIVADA", page: 1, confidence: 92, sourceText: "Paciente: PERSONA PRIVADA" },
        { key: "total", label: "Total cuenta", value: "1.234.567", page: 2, confidence: 87, sourceText: "Total cuenta: 1.234.567" },
      ],
      lines: [
        { description: "GLOSA CON ERROR", amount: 1200, page: 1, code: "ABC", quantity: 2, unitAmount: 600, confidence: 45, sourceText: "ABC GLOSA CON ERROR 2 600 1.200" },
        { description: "INSUMO NORMAL", amount: 800, page: 2, code: "DEF", quantity: 1, unitAmount: 800, confidence: 95, sourceText: "DEF INSUMO NORMAL 1 800" },
      ],
    },
  };
}

test("the LLM context is capped and does not send patient identity values", () => {
  const context = buildReaderAssistContext(sampleExtraction(), "account");
  assert.equal(context.lines.length, 2);
  assert.equal(context.fields[0]?.value, "[dato personal omitido]");
  assert.equal(context.fields[0]?.sourceText, undefined);
  assert.equal(context.lines[0]?.index, 1);
  assert.equal(context.documentType, "account");
});

test("parses only structured output from the Responses API", () => {
  const result = parseReaderAssistResponse({
    output_text: JSON.stringify({
      status: "assisted",
      summary: "Se detectó una posible corrección con evidencia.",
      fields: [],
      lineCorrections: [{ index: 1, page: 1, description: "GLOSA CORREGIDA", code: "ABC", quantity: 2, unitAmount: 600, amount: 1200, evidence: "ABC GLOSA CON ERROR", confidence: 0.76, reason: "La evidencia conserva código y valores." }],
      unknownItems: [],
      safetyNotes: ["Revisar contra el original."],
    }),
  });
  assert.equal(result.status, "assisted");
  assert.equal(result.lineCorrections[0]?.amount, 1200);
  assert.equal(result.lineCorrections[0]?.confidence, 0.76);
});

test("calls OpenAI only as a secondary reader and never stores the response", async () => {
  let requestInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ status: "assisted", summary: "Propuesta", fields: [], lineCorrections: [], unknownItems: [], safetyNotes: [] }) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestReaderAssist(buildReaderAssistContext(sampleExtraction(), "account"), undefined, { apiKey: "test-key", fetchImpl });
  assert.equal(result.status, "ready_for_review");
  assert.equal(result.model, "gpt-5.4-mini");
  assert.equal(requestInit?.method, "POST");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.match(String(body.input[1].content[0].text), /GLOSA CON ERROR/);
  assert.doesNotMatch(String(body.input[1].content[0].text), /PERSONA PRIVADA/);
});

test("does not call the provider when the API key is absent", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(() => requestReaderAssist(buildReaderAssistContext(sampleExtraction(), "account"), {}, { fetchImpl }), { code: "LLM_NOT_CONFIGURED" });
  assert.equal(called, false);
});

test("sends selected page images to GPT Vision without storing the response", async () => {
  const image: VisionPageImage = { page: 1, region: "zone", zone: { row: 1, column: 1, rows: 3, columns: 3 }, dataUrl: "data:image/jpeg;base64,ZmFrZQ==" };
  assert.equal(isVisionPageImage(image), true);
  assert.equal(isVisionPageImage({ ...image, dataUrl: "not-an-image" }), false);
  let requestInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ status: "assisted", summary: "La imagen permite contrastar la fila.", fields: [], lineCorrections: [], unknownItems: [], safetyNotes: ["Revisar contra el original."] }) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestVisionAssist(buildReaderAssistContext(sampleExtraction(), "account"), [image], undefined, { apiKey: "test-key", fetchImpl });
  assert.equal(result.mode, "vision");
  assert.equal(result.status, "ready_for_review");
  assert.deepEqual(result.reviewedPages, [1]);
  assert.equal(result.gridSize, 3);
  assert.equal(result.reviewedImageCount, 1);
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.input[1].content[2].type, "input_image");
  assert.match(body.input[1].content[2].image_url, /^data:image\/jpeg;base64,/);
  assert.match(body.input[1].content[1].text, /cuadrícula 3×3/);
  assert.equal(body.text.format.type, "json_schema");
});

test("allows Vision to propose a read when the deterministic reader has no lines", async () => {
  const extraction: DocumentExtraction = { pageCount: 1, usedOcr: true, account: { type: "account", label: "Cuenta clínica", pages: [1], fields: [], lines: [] } };
  const image: VisionPageImage = { page: 1, region: "full_page", dataUrl: "data:image/png;base64,ZmFrZQ==" };
  let called = false;
  const fetchImpl: typeof fetch = async (_input, init) => {
    called = true;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.input[1].content[0].text.includes('"lines":[]'), true);
    return new Response(JSON.stringify({ output_text: JSON.stringify({ status: "assisted", summary: "Se observó un renglón legible.", fields: [], lineCorrections: [{ index: 1, page: 1, description: "SUERO VISIBLE", code: null, quantity: 1, unitAmount: 100, amount: 100, evidence: "SUERO VISIBLE", confidence: 0.71, reason: "La glosa y el monto son visibles en la imagen." }], unknownItems: [], safetyNotes: [] }) }), { status: 200 });
  };
  const result = await requestVisionAssist(buildReaderAssistContext(extraction, "account"), [image], undefined, { apiKey: "test-key", fetchImpl });
  assert.equal(called, true);
  assert.equal(result.status, "ready_for_review");
  assert.equal(result.result.lineCorrections[0]?.description, "SUERO VISIBLE");
});

test("uses the LLM as a second clinical-account analyst with traceable line ids", async () => {
  const lines: ChileanBillingLine[] = [
    { id: "procedure-1", description: "APENDICECTOMIA", section: "Derecho Pabellon", amount: 1_500_000, page: 2 },
    { id: "suture-1", description: "SUTURA VICRYL 3-0", section: "Farmacia en Pabellon", amount: 22_500, page: 4 },
  ];
  const deterministic = analyzeClinicalAccount(lines);
  let requestInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        status: "ready_for_review",
        summary: "La cuenta contiene un episodio quirúrgico y materiales cobrados separadamente.",
        episode: {
          type: "surgical",
          hasOperatingRoom: true,
          hasHospitalStay: false,
          hasEmergency: false,
          anchors: [{ lineId: "procedure-1", page: 2, evidence: "APENDICECTOMIA" }],
        },
        lineHypotheses: [
          { lineId: "procedure-1", page: 2, bundle: "procedure", decision: "do_not_add", confidence: 0.99, rationale: "Es la prestación principal.", evidence: ["APENDICECTOMIA"], missingEvidence: [] },
          { lineId: "suture-1", page: 4, bundle: "operating_room", decision: "review", confidence: 0.93, rationale: "Sutura usada en el acto quirúrgico.", evidence: ["Farmacia en Pabellon"], missingEvidence: ["Registro de uso"] },
          { lineId: "invented", page: 9, bundle: "operating_room", decision: "review", confidence: 0.99, rationale: "No existe.", evidence: [], missingEvidence: [] },
        ],
        warnings: ["Hipótesis presuntiva."],
      }),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await requestAnalysisAssist(lines, deterministic, undefined, 1_522_500, undefined, { apiKey: "test-key", model: "gpt-test", fetchImpl });
  assert.equal(result.status, "ready_for_review");
  assert.equal(result.episode.hasOperatingRoom, true);
  assert.equal(result.lineHypotheses.length, 2);
  assert.equal(result.lineHypotheses.find((item) => item.lineId === "suture-1")?.bundle, "operating_room");
  assert.equal(result.lineHypotheses.some((item) => item.lineId === "invented"), false);
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-test");
  assert.equal(body.text.format.type, "json_schema");
  assert.match(body.input[1].content[0].text, /SUTURA VICRYL 3-0/);
});

test("rejects an unstructured second-analysis response", () => {
  const lines: ChileanBillingLine[] = [{ id: "line-1", description: "INSUMO", amount: 100, page: 1 }];
  assert.throws(() => parseAnalysisAssistResponse({ output_text: "no es json" }, lines, "gpt-test"), { code: "LLM_INVALID_RESPONSE" });
});
