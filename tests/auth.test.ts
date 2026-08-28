import assert from "node:assert/strict";
import test from "node:test";
import { signAuthToken, verifyAuthToken } from "../lib/server/auth.ts";
import { localCreateCase, localGetCase, localListCases } from "../lib/server/runtime-store.ts";

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

