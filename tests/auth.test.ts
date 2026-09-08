import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, developerUserFromKey, isDeveloperUser, sessionCookie, signAuthToken, verifyAuthToken } from "../lib/server/auth.ts";
import { GET as getAuthSession } from "../app/api/auth/session/route.ts";
import {
  localCreateCase,
  localDeleteDocument,
  localGetCase,
  localListCases,
  localRequestAdvisory,
  localSaveAnalysis,
  localSaveDocument,
  localSaveExtraction,
  localSaveMixedExtraction,
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

test("reconoce la identidad ChatGPT del administrador como desarrollador", () => {
  const previous = process.env.REVISATUCUENTA_ADMIN_USER_IDS;
  process.env.REVISATUCUENTA_ADMIN_USER_IDS = "admin-user-1,admin-user-2";
  try {
    assert.equal(isDeveloperUser({ id: "chatgpt:admin-user-2", email: "owner@example.com", displayName: "Owner", source: "chatgpt" }), true);
    assert.equal(isDeveloperUser({ id: "chatgpt:patient-user", email: "owner@example.com", displayName: "Owner", source: "chatgpt" }), false);
  } finally {
    if (previous === undefined) delete process.env.REVISATUCUENTA_ADMIN_USER_IDS;
    else process.env.REVISATUCUENTA_ADMIN_USER_IDS = previous;
  }
});

test("reconoce las dos claves cortas de desarrollador y rechaza otras", () => {
  const previous = process.env.REVISATUCUENTA_ADMIN_USER_IDS;
  const previousKeys = process.env.REVISATUCUENTA_DEVELOPER_KEYS;
  process.env.REVISATUCUENTA_ADMIN_USER_IDS = "lpaulr,aleretamal";
  process.env.REVISATUCUENTA_DEVELOPER_KEYS = "lpaulr,aleretamal";
  try {
    assert.equal(developerUserFromKey("lpaulr")?.id, "developer:lpaulr");
    assert.equal(developerUserFromKey("lpaulr")?.source, "development");
    assert.equal(developerUserFromKey("ALERETAMAL")?.email, "aleretamal@revisatucuenta.local");
    assert.equal(developerUserFromKey("otra-clave"), undefined);
    assert.equal(isDeveloperUser({ id: "chatgpt:opaque-1", email: "lpaulr@gmail.com", displayName: "Luis", source: "chatgpt" }), true);
    assert.equal(isDeveloperUser({ id: "chatgpt:opaque-2", email: "aleretamal@revisatucuenta.cl", displayName: "Ale", source: "chatgpt" }), true);
    assert.equal(isDeveloperUser({ id: "chatgpt:opaque-3", email: "otra@example.com", displayName: "Otra persona", source: "chatgpt" }), false);
  } finally {
    if (previous === undefined) delete process.env.REVISATUCUENTA_ADMIN_USER_IDS;
    else process.env.REVISATUCUENTA_ADMIN_USER_IDS = previous;
    if (previousKeys === undefined) delete process.env.REVISATUCUENTA_DEVELOPER_KEYS;
    else process.env.REVISATUCUENTA_DEVELOPER_KEYS = previousKeys;
  }
});

test("permite la sesión de paciente aunque su correo también sea administrador", async () => {
  const previousSecret = process.env.AUTH_SESSION_SECRET;
  const previousAdminIds = process.env.REVISATUCUENTA_ADMIN_USER_IDS;
  const previousDeveloperKeys = process.env.REVISATUCUENTA_DEVELOPER_KEYS;
  try {
    process.env.AUTH_SESSION_SECRET = "test-secret-with-more-than-thirty-two-characters";
    process.env.REVISATUCUENTA_ADMIN_USER_IDS = "lpaulr";
    process.env.REVISATUCUENTA_DEVELOPER_KEYS = "lpaulr";

    const patientToken = await createSessionToken({
      id: "email:patient-admin",
      email: "lpaulr@gmail.com",
      displayName: "Luis",
      source: "email",
    });
    const patientCookie = sessionCookie(patientToken, true).split(";", 1)[0];
    const patientResponse = await getAuthSession(new Request("https://revisatucuenta.cl/api/auth/session?view=patient", {
      headers: { cookie: patientCookie },
    }));
    assert.equal(patientResponse.status, 200);
    assert.equal((await patientResponse.json()).authenticated, true);

    const developer = developerUserFromKey("lpaulr");
    assert.ok(developer);
    const developerToken = await createSessionToken(developer);
    const developerCookie = sessionCookie(developerToken, true).split(";", 1)[0];
    const developerResponse = await getAuthSession(new Request("https://revisatucuenta.cl/api/auth/session?view=patient", {
      headers: { cookie: developerCookie },
    }));
    assert.equal(developerResponse.status, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSecret;
    if (previousAdminIds === undefined) delete process.env.REVISATUCUENTA_ADMIN_USER_IDS;
    else process.env.REVISATUCUENTA_ADMIN_USER_IDS = previousAdminIds;
    if (previousDeveloperKeys === undefined) delete process.env.REVISATUCUENTA_DEVELOPER_KEYS;
    else process.env.REVISATUCUENTA_DEVELOPER_KEYS = previousDeveloperKeys;
  }
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

test("invalida la matriz cuando se relee una cuenta o se actualiza el PAM", () => {
  const suffix = crypto.randomUUID();
  const owner = `reread-owner-${suffix}`;
  const caseId = `reread-case-${suffix}`;
  const accountId = `reread-account-${suffix}`;
  const pamId = `reread-pam-${suffix}`;
  const readyAssessment = { status: "ready", confidence: 1, parserMode: "direct_pdf", signals: [], lowConfidencePages: [], unknownItems: [], numericIssues: [], codeChangeNeeded: false } as const;
  const extraction = { pageCount: 1, usedOcr: false, readerVersion: "test", readerAssessment: readyAssessment, account: { type: "account" as const, label: "Cuenta", pages: [1], fields: [], lines: [{ description: "Cuenta", amount: 100, page: 1 }] } };
  const pamExtraction = { pageCount: 1, usedOcr: false, readerVersion: "test", readerAssessment: readyAssessment, pam: { type: "pam" as const, label: "PAM", pages: [1], fields: [], lines: [{ description: "PAM", amount: 90, page: 1 }] } };

  assert.equal(localCreateCase({ id: caseId, ownerUserId: owner, ownerEmail: "reread@example.com", patientName: "Paciente releído", episodeLabel: "Cuenta clínica" }), true);
  localSaveDocument({ id: accountId, caseId, name: "cuenta.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clínica", confidence: 95 });
  localSaveExtraction(accountId, extraction, 0);
  localSaveAnalysis(caseId, analyzeClinicalAccount([]));
  localSaveExtraction(accountId, extraction, 0);
  assert.equal(localGetCase(caseId, owner, true)?.analysis, undefined);

  localSaveDocument({ id: pamId, caseId, name: "pam.pdf", mimeType: "application/pdf", byteSize: 100, classification: "PAM / liquidación", confidence: 95 });
  localSaveAnalysis(caseId, analyzeClinicalAccount([]));
  localSaveExtraction(pamId, pamExtraction, 0);
  assert.equal(localGetCase(caseId, owner, true)?.analysis, undefined);
});

test("separa un PDF mixto en cuenta y PAM interno sin duplicar la fuente", () => {
  const suffix = crypto.randomUUID();
  const owner = `mixed-owner-${suffix}`;
  const caseId = `mixed-case-${suffix}`;
  const accountId = `mixed-account-${suffix}`;
  assert.equal(localCreateCase({ id: caseId, ownerUserId: owner, ownerEmail: "mixed@example.com", patientName: "Paciente mixto", episodeLabel: "Hospitalización" }), true);
  localSaveDocument({ id: accountId, caseId, name: "cuenta-y-pam.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clínica", confidence: 95 });

  const derivedId = localSaveMixedExtraction(accountId, {
    pageCount: 2,
    usedOcr: true,
    account: { type: "account", label: "Cuenta clínica", pages: [1], fields: [{ key: "total", label: "Total", value: "1000", page: 1, confidence: 1 }], lines: [{ description: "Día cama", amount: 1000, page: 1 }] },
    pam: { type: "pam", label: "PAM", pages: [2], fields: [{ key: "billed_total", label: "Total facturado", value: "900", page: 2, confidence: 1 }], lines: [{ description: "Prestación PAM", amount: 900, page: 2 }] },
  }, 2);
  const snapshot = localGetCase(caseId, owner, true);
  assert.ok(derivedId);
  assert.equal(snapshot?.documents.length, 2);
  assert.equal(snapshot?.documents.find((document) => document.id === accountId)?.extraction?.pam, undefined);
  assert.equal(snapshot?.documents.find((document) => document.id === derivedId)?.extraction?.account, undefined);
  assert.equal(snapshot?.documents.find((document) => document.id === derivedId)?.classification, "PAM / liquidación · detectado automáticamente");
  const replacementId = `mixed-replacement-${suffix}`;
  localSaveDocument({ id: replacementId, caseId, name: "cuenta-y-pam.pdf", mimeType: "application/pdf", byteSize: 100, classification: "Cuenta clínica", confidence: 95 });
  const replacementPamId = localSaveMixedExtraction(replacementId, {
    pageCount: 2,
    usedOcr: true,
    account: { type: "account", label: "Cuenta clínica", pages: [1], fields: [], lines: [{ description: "Cuenta nueva", amount: 2000, page: 1 }] },
    pam: { type: "pam", label: "PAM", pages: [2], fields: [], lines: [{ description: "PAM nueva", amount: 1800, page: 2 }] },
  }, 0);
  localDeleteDocument(accountId, caseId);
  assert.equal(localGetCase(caseId, owner, true)?.documents.some((document) => document.id === replacementPamId), true);
  localDeleteDocument(replacementId, caseId);
  assert.equal(localGetCase(caseId, owner, true)?.documents.length, 0);
});

test("registra una sola solicitud de asesoría sin autorizar reclamos", () => {
  const suffix = crypto.randomUUID();
  const owner = `advisory-owner-${suffix}`;
  const caseId = `advisory-case-${suffix}`;
  assert.equal(localCreateCase({ id: caseId, ownerUserId: owner, ownerEmail: "advisory@example.com", patientName: "Paciente asesoría", episodeLabel: "Cuenta clínica" }), true);
  localSaveAnalysis(caseId, analyzeClinicalAccount([]));

  const first = localRequestAdvisory(caseId);
  const second = localRequestAdvisory(caseId);
  const current = localGetCase(caseId, owner, true);

  assert.equal(first.requested, true);
  assert.equal(first.alreadyRequested, false);
  assert.equal(second.alreadyRequested, true);
  assert.equal(current?.activities.filter((activity) => activity.title === "Solicitud de asesoría recibida").length, 1);
  assert.equal(current?.authorization, undefined);
});
