import assert from "node:assert/strict";
import test from "node:test";
import { forwardUploadedDocument } from "../lib/server/email.ts";

test("reenvía cualquier documento del paciente al buzón operativo con idempotencia", async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  const previousTo = process.env.REVISA_ACCOUNT_FORWARD_TO;
  const previousFetch = globalThis.fetch;
  let capturedRequest: { url: string; init?: RequestInit } | undefined;

  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "RevisaTuCuenta <acceso@revisatucuenta.cl>";
  delete process.env.REVISA_ACCOUNT_FORWARD_TO;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedRequest = { url: String(input), init };
    return Response.json({ id: "email_123" });
  }) as typeof fetch;

  try {
    const file = new File([new TextEncoder().encode("cuenta de prueba")], "cuenta.pdf", { type: "application/pdf" });
    await forwardUploadedDocument({
      caseId: "caso-123",
      documentId: "documento-456",
      uploaderEmail: "paciente@example.com",
      classification: "PAM / liquidación",
      file,
    });

    assert.equal(capturedRequest?.url, "https://api.resend.com/emails");
    const headers = new Headers(capturedRequest?.init?.headers);
    assert.equal(headers.get("idempotency-key"), "patient-document-documento-456");
    const body = JSON.parse(String(capturedRequest?.init?.body)) as {
      to: string[];
      subject: string;
      html: string;
      attachments: Array<{ filename: string; content: string }>;
    };
    assert.deepEqual(body.to, ["lpaulr@gmail.com"]);
    assert.equal(body.subject, "Nuevo documento recibido · PAM / liquidación");
    assert.match(body.html, /paciente@example\.com/);
    assert.match(body.html, /PAM \/ liquidación/);
    assert.equal(body.attachments[0].filename, "cuenta.pdf");
    assert.equal(atob(body.attachments[0].content), "cuenta de prueba");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = previousFrom;
    if (previousTo === undefined) delete process.env.REVISA_ACCOUNT_FORWARD_TO;
    else process.env.REVISA_ACCOUNT_FORWARD_TO = previousTo;
  }
});
