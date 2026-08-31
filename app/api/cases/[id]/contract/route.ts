import { ensureCaseSchema } from "../../../../../lib/server/case-schema.ts";
import {
  buildPatientServiceContract,
  DEFAULT_PATIENT_SERVICE_PRICE_CLP,
  PATIENT_SERVICE_CONTRACT_VERSION,
} from "../../../../../lib/contracts/patient-service-contract.ts";
import { getCloudflareEnv, localGetCase, localGetServiceContract, localSaveServiceContract } from "../../../../../lib/server/runtime-store.ts";
import { requireApiUser } from "../../../../../lib/server/auth.ts";
import { caseAccessResponse } from "../../../../../lib/server/case-access.ts";

const MANDATE_SCOPE = "Poder especial y limitado para solicitar antecedentes, preparar y presentar aclaraciones y reclamos administrativos del episodio indicado; sin consentir tratamientos, transigir, renunciar derechos ni recibir fondos.";

function configuredValue(env: any, name: string) {
  const fromBinding = env?.[name];
  if (typeof fromBinding === "string" && fromBinding.trim()) return fromBinding.trim();
  if (typeof process !== "undefined") {
    const fromProcess = process.env[name]?.trim();
    if (fromProcess) return fromProcess;
  }
  return undefined;
}

function configuredPrice(env: any) {
  const value = Number(configuredValue(env, "PATIENT_ADVISORY_PRICE_CLP"));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : DEFAULT_PATIENT_SERVICE_PRICE_CLP;
}

function configuredPaymentUrl(env: any) {
  if ((configuredValue(env, "PATIENT_PAYMENT_MODE") || "demo").toLowerCase() !== "live") return undefined;
  const value = configuredValue(env, "PATIENT_ADVISORY_PAYMENT_URL");
  return value && /^https:\/\//i.test(value) ? value : undefined;
}

function contractPayload(row: any, paymentUrl?: string) {
  if (!row) return undefined;
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    contractVersion: String(row.contract_version),
    status: String(row.status),
    patientName: String(row.patient_name),
    patientEmail: String(row.patient_email),
    companyName: String(row.company_name),
    episodeLabel: String(row.episode_label),
    contractText: String(row.contract_text),
    priceClp: Number(row.price_clp || 0),
    acceptedTerms: Number(row.accepted_terms) === 1,
    dataConsent: Number(row.data_consent) === 1,
    mandateConsent: Number(row.mandate_consent) === 1,
    signerName: row.signer_name ? String(row.signer_name) : undefined,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    paymentStatus: String(row.payment_status || "not_started"),
    paymentUrl: paymentUrl || (row.payment_url ? String(row.payment_url) : undefined),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function draftContract(caseId: string, patientName: string, patientEmail: string, episodeLabel: string, priceClp: number, env: any) {
  const companyName = configuredValue(env, "RAKUN_LEGAL_NAME") || "Rakun SpA";
  return {
    id: `draft-${caseId}`,
    caseId,
    contractVersion: PATIENT_SERVICE_CONTRACT_VERSION,
    status: "draft",
    patientName,
    patientEmail,
    companyName,
    episodeLabel,
    contractText: buildPatientServiceContract({
      patientName,
      patientEmail,
      episodeLabel,
      companyName,
      companyRut: configuredValue(env, "RAKUN_RUT"),
      companyAddress: configuredValue(env, "RAKUN_ADDRESS"),
      legalRepresentative: configuredValue(env, "RAKUN_LEGAL_REPRESENTATIVE"),
      priceClp,
    }),
    priceClp,
    acceptedTerms: false,
    dataConsent: false,
    mandateConsent: false,
    paymentStatus: "not_started",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function paymentUrl(request: Request, env: any, caseId: string) {
  return configuredPaymentUrl(env) || `${new URL(request.url).origin}/payment-demo?case=${encodeURIComponent(caseId)}`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;

  if (!env?.DB) {
    const snapshot = localGetCase(id, auth.user.id, true);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    const stored = localGetServiceContract(id, auth.user.id, true);
    return Response.json({ contract: stored ? contractPayload(stored) : draftContract(id, snapshot.case.patientName, snapshot.case.contactEmail || auth.user.email, snapshot.case.episodeLabel, configuredPrice(env), env) });
  }

  await ensureCaseSchema(env.DB);
  const row = await env.DB.prepare(`SELECT patient_name, contact_email, episode_label FROM cases WHERE id = ?`).bind(id).first();
  if (!row) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  const stored = await env.DB.prepare(`SELECT * FROM service_contracts WHERE case_id = ?`).bind(id).first();
  return Response.json({
    contract: stored
      ? contractPayload(stored)
      : draftContract(id, String(row.patient_name), String(row.contact_email || auth.user.email), String(row.episode_label), configuredPrice(env), env),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => ({})) as {
    contractVersion?: string;
    acceptedTerms?: boolean;
    dataConsent?: boolean;
    mandateConsent?: boolean;
    signerName?: string;
  };
  if (body.contractVersion !== PATIENT_SERVICE_CONTRACT_VERSION || body.acceptedTerms !== true || body.dataConsent !== true || body.mandateConsent !== true) {
    return Response.json({ error: "Debes leer y aceptar el contrato, la autorización de datos y el mandato limitado." }, { status: 400 });
  }
  const signerName = body.signerName?.trim();
  if (!signerName || signerName.length < 3) return Response.json({ error: "Ingresa tu nombre completo para registrar la aceptación." }, { status: 400 });

  const env = await getCloudflareEnv();
  const denied = await caseAccessResponse(env, id, auth.user);
  if (denied) return denied;
  const now = new Date().toISOString();
  const companyName = configuredValue(env, "RAKUN_LEGAL_NAME") || "Rakun SpA";
  const priceClp = configuredPrice(env);
  const payUrl = await paymentUrl(request, env, id);

  if (!env?.DB) {
    const snapshot = localGetCase(id, auth.user.id, true);
    if (!snapshot) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    const existing = localGetServiceContract(id, auth.user.id, true);
    if (existing) return Response.json({ contract: contractPayload(existing), paymentUrl: existing.payment_url || payUrl, alreadyAccepted: true });
    const record = localSaveServiceContract({
      id: crypto.randomUUID(),
      case_id: id,
      contract_version: PATIENT_SERVICE_CONTRACT_VERSION,
      status: "accepted",
      patient_name: snapshot.case.patientName,
      patient_email: snapshot.case.contactEmail || auth.user.email,
      company_name: companyName,
      episode_label: snapshot.case.episodeLabel,
      contract_text: buildPatientServiceContract({ patientName: snapshot.case.patientName, patientEmail: snapshot.case.contactEmail || auth.user.email, episodeLabel: snapshot.case.episodeLabel, companyName, companyRut: configuredValue(env, "RAKUN_RUT"), companyAddress: configuredValue(env, "RAKUN_ADDRESS"), legalRepresentative: configuredValue(env, "RAKUN_LEGAL_REPRESENTATIVE"), priceClp }),
      price_clp: priceClp,
      accepted_terms: 1,
      data_consent: 1,
      mandate_consent: 1,
      signer_name: signerName,
      accepted_at: now,
      payment_status: "pending",
      payment_url: payUrl,
    });
    return Response.json({ contract: contractPayload(record), paymentUrl: payUrl, alreadyAccepted: false });
  }

  await ensureCaseSchema(env.DB);
  const caseRow = await env.DB.prepare(`SELECT patient_name, contact_email, episode_label FROM cases WHERE id = ?`).bind(id).first();
  if (!caseRow) return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  const existing = await env.DB.prepare(`SELECT * FROM service_contracts WHERE case_id = ?`).bind(id).first();
  if (existing) return Response.json({ contract: contractPayload(existing), paymentUrl: existing.payment_url || payUrl, alreadyAccepted: true });
  const patientName = String(caseRow.patient_name);
  const patientEmail = String(caseRow.contact_email || auth.user.email);
  const episodeLabel = String(caseRow.episode_label);
  const contractText = buildPatientServiceContract({ patientName, patientEmail, episodeLabel, companyName, companyRut: configuredValue(env, "RAKUN_RUT"), companyAddress: configuredValue(env, "RAKUN_ADDRESS"), legalRepresentative: configuredValue(env, "RAKUN_LEGAL_REPRESENTATIVE"), priceClp });
  const contractId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO service_contracts (id, case_id, contract_version, status, patient_name, patient_email, company_name, episode_label, contract_text, price_clp, accepted_terms, data_consent, mandate_consent, signer_name, accepted_at, payment_status, payment_url, updated_at) VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, 'pending', ?, ?)`)
      .bind(contractId, id, PATIENT_SERVICE_CONTRACT_VERSION, patientName, patientEmail, companyName, episodeLabel, contractText, priceClp, signerName, now, payUrl, now),
    env.DB.prepare(`INSERT INTO claim_authorizations (id, case_id, authorized, scope, authorized_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(case_id) DO UPDATE SET authorized = 1, scope = excluded.scope, authorized_at = excluded.authorized_at`)
      .bind(crypto.randomUUID(), id, MANDATE_SCOPE, now),
    env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail, event_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, "Contrato de asesoría aceptado", "La versión del contrato quedó registrada junto con la autorización de datos y mandato limitado.", now),
  ]);
  const saved = await env.DB.prepare(`SELECT * FROM service_contracts WHERE id = ?`).bind(contractId).first();
  return Response.json({ contract: contractPayload(saved), paymentUrl: payUrl, alreadyAccepted: false });
}
