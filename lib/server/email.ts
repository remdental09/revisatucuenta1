function runtimeEnv(name: string) {
  if (typeof process !== "undefined") {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  const globalBindings = (globalThis as typeof globalThis & { __revisaRuntimeBindings?: Record<string, unknown> }).__revisaRuntimeBindings;
  const processBindings = typeof process !== "undefined"
    ? (process as typeof process & { __revisaRuntimeBindings?: Record<string, unknown> }).__revisaRuntimeBindings
    : undefined;
  const value = globalBindings?.[name] ?? processBindings?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function sendResendEmail(payload: Record<string, unknown>, idempotencyKey?: string) {
  const apiKey = runtimeEnv("RESEND_API_KEY");
  if (!apiKey) throw new Error("El envío de correos todavía no está configurado");

  let lastError = "No se pudo enviar el correo";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) return await response.json().catch(() => ({}));

      const responsePayload = await response.json().catch(() => ({})) as { message?: string };
      lastError = responsePayload.message || "No se pudo enviar el correo";
      if (response.status !== 429 && response.status < 500) break;
    } catch (reason) {
      lastError = reason instanceof Error ? reason.message : lastError;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(lastError);
}

export async function sendAccessLink(input: { email: string; url: string }) {
  const from = runtimeEnv("AUTH_EMAIL_FROM");
  if (!from) throw new Error("El envío de correos todavía no está configurado");

  const safeUrl = escapeHtml(input.url);
  await sendResendEmail({
    from,
    to: [input.email],
    subject: "Confirma tu correo para revisar tu cuenta | RevisaTuCuenta",
    html: `<div style="font-family:Arial,sans-serif;color:#173f34;line-height:1.6;max-width:560px;margin:auto"><h1 style="font-family:Georgia,serif;font-weight:500">Tu enlace de acceso</h1><p>Confirma tu correo para iniciar o continuar la revisión de tu cuenta de hospitalización.</p><p><a href="${safeUrl}" style="display:inline-block;background:#126147;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Ingresar a RevisaTuCuenta</a></p><p style="font-size:13px;color:#667b72">Este enlace vence en 15 minutos. Si no solicitaste el acceso, puedes ignorar este mensaje.</p></div>`,
  });
}

export async function forwardUploadedDocument(input: {
  caseId: string;
  documentId: string;
  uploaderEmail: string;
  classification: string;
  file: File;
}) {
  const from = runtimeEnv("AUTH_EMAIL_FROM");
  const to = runtimeEnv("REVISA_ACCOUNT_FORWARD_TO") || "lpaulr@gmail.com";
  if (!from) throw new Error("El reenvío de cuentas todavía no está configurado");

  const filename = input.file.name.replace(/[\r\n]/g, "_") || "cuenta-clinica";
  const content = bytesToBase64(new Uint8Array(await input.file.arrayBuffer()));
  const safeCaseId = escapeHtml(input.caseId);
  const safeDocumentId = escapeHtml(input.documentId);
  const safeUploader = escapeHtml(input.uploaderEmail);
  const safeFilename = escapeHtml(filename);
  const safeClassification = escapeHtml(input.classification);
  const safeSubjectClassification = input.classification.replace(/[\r\n]/g, " ").slice(0, 100);
  const safeIdempotencyDocumentId = input.documentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);

  return sendResendEmail({
    from,
    to: [to],
    subject: `Nuevo documento recibido · ${safeSubjectClassification}`,
    html: `<div style="font-family:Arial,sans-serif;color:#173f34;line-height:1.6;max-width:620px;margin:auto"><h1 style="font-family:Georgia,serif;font-weight:500">Nuevo documento de paciente</h1><p>Se adjunta el archivo recibido en RevisaTuCuenta para almacenamiento y revisión interna.</p><table style="border-collapse:collapse;width:100%"><tr><td style="padding:6px 0;color:#667b72">Expediente</td><td style="padding:6px 0"><strong>${safeCaseId}</strong></td></tr><tr><td style="padding:6px 0;color:#667b72">Tipo</td><td style="padding:6px 0">${safeClassification}</td></tr><tr><td style="padding:6px 0;color:#667b72">Documento</td><td style="padding:6px 0">${safeDocumentId}</td></tr><tr><td style="padding:6px 0;color:#667b72">Archivo</td><td style="padding:6px 0">${safeFilename}</td></tr><tr><td style="padding:6px 0;color:#667b72">Usuario</td><td style="padding:6px 0">${safeUploader}</td></tr></table><p style="font-size:13px;color:#667b72">Este mensaje contiene información personal y de salud. Debe mantenerse dentro del flujo autorizado de revisión.</p></div>`,
    attachments: [{ filename, content }],
  }, `patient-document-${safeIdempotencyDocumentId}`);
}
