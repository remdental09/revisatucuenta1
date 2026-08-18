import assert from "node:assert/strict";
import test from "node:test";
import { structureDocument } from "../lib/extraction/parsers.ts";

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

