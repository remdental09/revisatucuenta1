import assert from "node:assert/strict";
import test from "node:test";
import { buildReaderAssistContext, parseReaderAssistResponse, requestReaderAssist } from "../lib/server/openai-reader-assist.ts";
import type { DocumentExtraction } from "../lib/extraction/types.ts";

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
      llmAssist: { status: "not_configured", role: "assistive_only", contractVersion: "reader-change-v1" },
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
