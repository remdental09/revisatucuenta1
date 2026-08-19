import assert from "node:assert/strict";
import test from "node:test";
import { structureDocument } from "../lib/extraction/parsers.ts";
import { textItemsToLines } from "../lib/extraction/client.ts";

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
