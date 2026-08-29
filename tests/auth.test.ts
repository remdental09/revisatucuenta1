import assert from "node:assert/strict";
import test from "node:test";
import { signAuthToken, verifyAuthToken } from "../lib/server/auth.ts";
import {
  localCreateCase,
  localDeleteDocument,
  localGetCase,
  localListCases,
  localSaveAnalysis,
  localSaveDocument,
} from "../lib/server/runtime-store.ts";
import { analyzeClinicalAccount } from "../lib/rules/chilean-account.ts";

test("accepts a valid signed session and rejects tampering", async () => {
  const secret = "test-secret-with-more-than-thirty-two-characters";
  const payload = {
    purpose: "session" as const,
    userId: "email:owner-a",
    email: "owner@example.com",
    displayName: "Owner",
    issuedAt: 1_000,
    expiresAt: 2_000,
  };
  const token = await signAuthToken(payload, secret);
  assert.deepEqual(await verifyAuthToken(token, secret, "session", 1_500), payload);
  assert.equal(await verifyAuthToken(`${token.slice(0, -1)}x`, secret, "session", 1_500), undefined);
  assert.equal(await verifyAuthToken(token, secret, "session", 2_001), undefined);
  assert.equal(await verifyAuthToken(token, secret, "magic_link", 1_500), undefined);
});

test("isolates volatile cases by owner", () => {
  const suffix = crypto.randomUUID();
  const ownerA = `owner-a-${suffix}`;
  const ownerB = `owner-b-${suffix}`;
  const caseA = `case-a-${suffix}`;
  const caseB = `case-b-${suffix}`;
  assert.equal(localCreateCase({ id: caseA, ownerUserId: ownerA, ownerEmail: "a@example.com", patientName: "Paciente A", episodeLabel: "Cuenta A" }), true);
  assert.equal(localCreateCase({ id: caseB, ownerUserId: ownerB, ownerEmail: "b@example.com", patientName: "Paciente B", episodeLabel: "Cuenta B" }), true);
  assert.equal(localGetCase(caseA, ownerA)?.case.patientName, "Paciente A");
  assert.equal(localGetCase(caseA, ownerB), null);
  assert.equal(localListCases(ownerA).some((item) => item.id === caseA), true);
  assert.equal(localListCases(ownerA).some((item) => item.id === caseB), false);
  assert.equal(localListCases(ownerA, true).some((item) => item.id === caseB), true);
});

test("reemplazar una cuenta elimina la anterior y conserva los demás documentos", () => {
  const suffix = crypto.randomUUID();
  const owner = `replacement-owner-${suffix}`;
  const caseId = `replacement-case-${suffix}`;
  const oldAccountId = `old-account-${suffix}`;
  const newAccountId = `new-account-${suffix}`;
  const pamId = `pam-${suffix}`;

  assert.equal(localCreateCase({ id: caseId, ownerUserId: owner, ownerEmail: "replacement@example.com", patientName: "Paciente de prueba", episodeLabel: "Cuenta clínica" }), true);
  localSaveDocument({ id: oldAccountId, caseId, name: "cuenta-anterior.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clínica", confidence: 95 });
  localSaveDocument({ id: pamId, caseId, name: "pam.pdf", mimeType: "application/pdf", byteSize: 100, classification: "PAM / liquidación", confidence: 95 });
  localSaveDocument({ id: newAccountId, caseId, name: "cuenta-nueva.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clínica", confidence: 95 });
  localSaveAnalysis(caseId, analyzeClinicalAccount([]));

  const deleted = localDeleteDocument(oldAccountId, caseId);
  const current = localGetCase(caseId, owner, true);
  assert.equal(deleted?.classification, "Cuenta clínica");
  assert.deepEqual(current?.documents.map((document) => document.id).sort(), [pamId, newAccountId].sort());
  assert.equal(current?.analysis, undefined);

  localSaveAnalysis(caseId, analyzeClinicalAccount([]));
  localDeleteDocument(pamId, caseId);
  assert.ok(localGetCase(caseId, owner, true)?.analysis);
});
