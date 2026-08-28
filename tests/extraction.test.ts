import assert from "node:assert/strict";
import test from "node:test";
import { structureDocument } from "../lib/extraction/parsers.ts";
import { extractedPatientField } from "../lib/extraction/patient-identity.ts";
import { textItemsToLines } from "../lib/extraction/client.ts";
import { assessExtractionQuality, buildReaderChangeProposal } from "../lib/extraction/reader-quality.ts";
import { localCreateCase, localGetCase, localSaveDocument, localSaveExtraction } from "../lib/server/runtime-store.ts";

test("extracts account and PAM independently from a mixed document", () => {
  const result = structureDocument(
    [
      {
        page: 1,
        text: "CUENTA CLÍNICA\nPaciente: María P.\nFecha ingreso: 06/07/2025\nDía cama 452.075\nTotal cuenta: $6.912.876",
      },
      {
        page: 2,
        text: "PAM ISAPRE Nueva Masvida\nFolio: PAM-2025-88\nTotal facturado: $6.912.875\nBonificación: $6.472.806\nCopago: $440.069",
      },
    ],
    "mixed",
    false,
  );

  assert.deepEqual(result.account?.pages, [1]);
  assert.deepEqual(result.pam?.pages, [2]);
  assert.equal(result.account?.fields.find((field) => field.key === "total")?.value, "6.912.876");
  assert.equal(result.pam?.fields.find((field) => field.key === "bonus")?.value, "6.472.806");
  assert.equal(result.pam?.fields.find((field) => field.key === "copay")?.value, "440.069");
});

test("preserves PDF table rows using text coordinates", () => {
  const text = textItemsToLines([
    { str: "600510115", transform: [1, 0, 0, 1, 10, 500] },
    { str: "TERMOMETRO DIGITAL FLEXI", transform: [1, 0, 0, 1, 80, 500] },
    { str: "21/11/2021", transform: [1, 0, 0, 1, 300, 500] },
    { str: "1,000", transform: [1, 0, 0, 1, 430, 500] },
    { str: "3.408", transform: [1, 0, 0, 1, 500, 500] },
    { str: "OTRA FILA", transform: [1, 0, 0, 1, 10, 480] },
  ]);
  assert.equal(text.split("\n").length, 2);
  assert.match(text, /^600510115 TERMOMETRO DIGITAL FLEXI/);
});

test("extracts Clínica Alemana rows and Vida Tres bonos", () => {
  const account = structureDocument(
    [{
      page: 3,
      text: "MATERIALES FARMACIA\n600510115 TERMOMETRO DIGITAL FLEXI 21/11/2021 1210149 1,000 3.408 3.408 0 0 3.408 648 4.056 2.839",
    }],
    "account",
    false,
  );
  const pam = structureDocument(
    [{
      page: 1,
      text: "BONO HOSPITALARIO SOLO POR LA BONIFICACIÓN DE LA ISAPRE\n1802081 COLECISTECTOMIA POR VIDEOLAPAROSCOPIA 1 $ 286.744 $ 200.721 $ 86.023\nTotal $ 286.744 $ 200.721 $ 86.023",
    }],
    "pam",
    false,
  );
  assert.equal(account.account?.lines[0]?.code, "600510115");
  assert.equal(account.account?.lines[0]?.amount, 3408);
  assert.equal(account.account?.lines[0]?.section, "Materiales clínicos");
  assert.equal(pam.pam?.lines[0]?.amount, 286744);
  assert.equal(pam.pam?.fields.find((field) => field.key === "bonus")?.value, "200.721");
});

test("extracts Clínica Alemana patient identity without confusing the company RUT", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "Informe de Cuentas al Paciente",
        "Empresa Rut 96770100-9 Clínica Alemana de Santiago S.A.",
        "Previsión ISAPRE BANMEDICA S.A.",
        "Sucursal Vitacura",
        "Nombre Paciente Rut: 00000000-0 PERSONA EJEMPLO PRUEBA",
        "Cama Actual/Egreso 237ES",
        "Cuenta 1305597 - 1 Cerrada",
        "Fecha Ingreso 16/06/2023 22:08 Cama Actual/Egreso 237ES Fecha de Alta 22/06/2023 18:42",
      ].join("\n"),
    }],
    "account",
    false,
  );

  assert.equal(result.account?.fields.find((field) => field.key === "provider")?.value, "Clínica Alemana de Santiago S.A.");
  assert.equal(result.account?.fields.find((field) => field.key === "patient")?.value, "PERSONA EJEMPLO PRUEBA");
  assert.equal(result.account?.fields.find((field) => field.key === "patient_rut")?.value, "00000000-0");
  assert.equal(result.account?.fields.find((field) => field.key === "account_number")?.value, "1305597");
});

test("extracts Clínica Santa María rows, glued dates, and returns", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "Paciente : PERSONA EJEMPLO SANTA MARIA Rut Paciente : 00.000.000 - 0",
        "Fecha_Ingreso : 18/02/2025 09:21:00 Fecha Egreso : 24/02/2025 13:00:00",
        "Id. Ingreso : 1.111.111 - 1",
        "Empresa Emisora : CLINICA SANTA MARIA",
        "04-04-003-00 ECOTOMOGRAFIA ABDOMINAL 18/02/2025 95.600 1 95.600",
        "60450076 GLUCOSA 5% 4G NACL+2G KCL (30MEQ/XC23/02/2025 -10.077 1 (-10.077)",
        "CLINICA SANTA MARIA 5.204.520",
        "Total Cuenta : 5.788.320",
      ].join("\n"),
    }],
    "account",
    false,
  );

  assert.equal(result.account?.fields.find((field) => field.key === "provider")?.value, "CLINICA SANTA MARIA");
  assert.equal(result.account?.fields.find((field) => field.key === "patient")?.value, "PERSONA EJEMPLO SANTA MARIA");
  assert.equal(result.account?.fields.find((field) => field.key === "patient_rut")?.value, "00000000-0");
  assert.equal(result.account?.fields.find((field) => field.key === "account_number")?.value, "1.111.111 - 1");
  assert.equal(result.account?.fields.find((field) => field.key === "discharge_date")?.value, "24/02/2025");
  assert.deepEqual(result.account?.lines.map((line) => line.amount), [95600, -10077]);
  assert.deepEqual(result.account?.lines.map((line) => line.date), ["18/02/2025", "23/02/2025"]);
});

test("extracts patient identity from an OCR-style Indisa account", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "Estado Cuenta Paciente Definitiva - Detallada",
        "Empresa : CLINICA INDISA",
        "Id. Ingreso : 611.915 - 8",
        "Rut Paclente : 00.000.000 - 0",
        "Paciente : PERSONA EJEMPLO INDISA",
        "Rut Titular : 99.999.999 - 9",
      ].join("\n"),
    }],
    "account",
    true,
  );

  assert.equal(result.account?.fields.find((field) => field.key === "provider")?.value, "CLINICA INDISA");
  assert.equal(result.account?.fields.find((field) => field.key === "patient")?.value, "PERSONA EJEMPLO INDISA");
  assert.equal(result.account?.fields.find((field) => field.key === "patient_rut")?.value, "00000000-0");
});

test("extracts a patient name placed on the line after its OCR label", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "CUENTA CLINICA ESCANEADA",
        "Nombre del Paciente:",
        "PERSONA OCR EJEMPLO",
        "Rut del Paciente: 00.000.000 - 0",
      ].join("\n"),
    }],
    "account",
    true,
  );

  assert.equal(result.account?.fields.find((field) => field.key === "patient")?.value, "PERSONA OCR EJEMPLO");
  assert.equal(result.account?.fields.find((field) => field.key === "patient_rut")?.value, "00000000-0");
});

test("registers a confidently extracted patient name in a placeholder case", () => {
  const caseId = "identity-registration-test";
  const documentId = "identity-registration-document";
  const extraction = structureDocument(
    [{ page: 1, text: "CUENTA CLINICA\nPaciente: PERSONA REGISTRADA EJEMPLO\nRut Paciente: 00.000.000-0" }],
    "account",
    false,
  );
  const patientField = extractedPatientField(extraction);
  assert.ok(patientField);

  localCreateCase({ id: caseId, patientName: "Paciente", episodeLabel: "Revisión de cuenta clínica" });
  localSaveDocument({ id: documentId, caseId, name: "cuenta-ejemplo.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clinica", confidence: 95 });
  localSaveExtraction(documentId, extraction, extraction.account?.fields.length ?? 0, patientField.value);

  assert.equal(localGetCase(caseId)?.case.patientName, "PERSONA REGISTRADA EJEMPLO");
});

test("separa códigos pegados a la glosa y conserva la sección entre páginas", () => {
  const result = structureDocument(
    [
      {
        page: 1,
        text: [
          "MATERIALES CLINICOS",
          "600513920MEDIAS ANTIEMBOLISMO L 15/05/2025 8.752 1 8.752",
        ].join("\n"),
      },
      {
        page: 2,
        text: [
          "500507248PROPOFOL KIT 1% 100 ML 15/05/2025 43.350 1 43.350",
          "600516567394945 TUBO ENDOTRAQUEAL 15/05/2025 5.288 1 5.288",
          "NATH. 86204",
          "C/VACUOTIP 248016",
          "DESECHABLE 2006",
        ].join("\n"),
      },
    ],
    "account",
    false,
  );

  assert.deepEqual(
    result.account?.lines.map(({ code, description, amount, section }) => ({ code, description, amount, section })),
    [
      { code: "600513920", description: "MEDIAS ANTIEMBOLISMO L", amount: 8752, section: "Materiales clínicos" },
      { code: "500507248", description: "PROPOFOL KIT 1% 100 ML", amount: 43350, section: "Materiales clínicos" },
      { code: "600516567", description: "394945 TUBO ENDOTRAQUEAL", amount: 5288, section: "Materiales clínicos" },
    ],
  );
});

test("conserva la entidad facturadora por bloque de cuenta", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "96770100-9 Clínica Alemana de Santiago S.A. 00:15",
        "MATERIALES CLINICOS",
        "600510115 TERMOMETRO DIGITAL FLEXI 31/03/2021 3.408 1 3.408",
        "77413290-2 Servicios Clinica Alemana Ltda. 00:15",
        "HONORARIOS QUIRURGICOS",
        "2004006 Cesárea 31/03/2021 105.924 1 105.924",
      ].join("\n"),
    }],
    "account",
    false,
  );
  assert.equal(result.account?.lines[0]?.providerId, "96770100-9 Clínica Alemana de Santiago S.A.");
  assert.equal(result.account?.lines[1]?.providerId, "77413290-2 Servicios Clinica Alemana Ltda.");
});

test("reconoce filas OCR de cuenta clínica con columnas completas", () => {
  const result = structureDocument(
    [{
      page: 1,
      text: [
        "DIA CAMA",
        "22100039 CALZON CLINICO 06-07:2025 1 1.641 0 1.379 1.379 262 1.6411",
        "22020145 REMOVEDOR DE ADHESIVO 06-07-2005 2 319 0 536 536 102 6381",
        "22040003 JERINGA 10 CC EMBUTIDA 06-07-2025 5 421 0 1.770 1.770 335 2.1051",
        "18-02-053-02 APENDICECTOMIA POR VIA 06-07-2025 1 1.914.834 185.990 1.452.810 1.638.800 276.034 1.914.834 2 *",
      ].join("\n"),
    }],
    "account",
    true,
  );

  assert.deepEqual(
    result.account?.lines.map(({ code, description, amount, unitAmount, quantity, date, section }) => ({
      code,
      description,
      amount,
      unitAmount,
      quantity,
      date,
      section,
    })),
    [
      {
        code: "22100039",
        description: "CALZON CLINICO",
        amount: 1641,
        unitAmount: 1641,
        quantity: 1,
        date: "06/07/2025",
        section: "Hospitalización",
      },
      {
        code: "22020145",
        description: "REMOVEDOR DE ADHESIVO",
        amount: 638,
        unitAmount: 319,
        quantity: 2,
        date: "06/07/2005",
        section: "Hospitalización",
      },
      {
        code: "22040003",
        description: "JERINGA 10 CC EMBUTIDA",
        amount: 2105,
        unitAmount: 421,
        quantity: 5,
        date: "06/07/2025",
        section: "Hospitalización",
      },
      {
        code: "18-02-053-02",
        description: "APENDICECTOMIA POR VIA",
        amount: 1914834,
        unitAmount: 1914834,
        quantity: 1,
        date: "06/07/2025",
        section: "Hospitalización",
      },
    ],
  );
});

test("marca un formato sin líneas y prepara una propuesta sin cambiar el código", () => {
  const extraction = structureDocument([{ page: 1, text: "CUENTA CLINICA FORMATO NUEVO\nContenido no reconocido" }], "account", false);
  const assessment = assessExtractionQuality(extraction, "account");
  assert.equal(assessment.status, "reader_change_needed");
  assert.equal(assessment.codeChangeNeeded, true);
  assert.equal(assessment.llmAssist.role, "assistive_only");
  const proposal = buildReaderChangeProposal(assessment, "cuenta-nueva.pdf");
  assert.equal(proposal.status, "pending_human_review");
  assert.match(proposal.safetyBoundary, /no modifica el lector/);
});
