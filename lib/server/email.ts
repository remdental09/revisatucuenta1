function runtimeEnv(name: string) {
  if (typeof process === "undefined") return undefined;
  return process.env[name]?.trim() || undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendAccessLink(input: { email: string; url: string }) {
  const apiKey = runtimeEnv("RESEND_API_KEY");
  const from = runtimeEnv("AUTH_EMAIL_FROM");
  if (!apiKey || !from) throw new Error("El envío de correos todavía no está configurado");

  const safeUrl = escapeHtml(input.url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: "Confirma tu correo para revisar tu cuenta | RevisaTuCuenta",
      html: `<div style="font-family:Arial,sans-serif;color:#173f34;line-height:1.6;max-width:560px;margin:auto"><h1 style="font-family:Georgia,serif;font-weight:500">Tu enlace de acceso</h1><p>Confirma tu correo para iniciar o continuar la revisión de tu cuenta de hospitalización.</p><p><a href="${safeUrl}" style="display:inline-block;background:#126147;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Ingresar a RevisaTuCuenta</a></p><p style="font-size:13px;color:#667b72">Este enlace vence en 15 minutos. Si no solicitaste el acceso, puedes ignorar este mensaje.</p></div>`,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "No se pudo enviar el correo de acceso");
  }
}
