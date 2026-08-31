"use client";

import { useEffect, useState } from "react";

type DemoContract = { caseId: string; companyName: string; patientName: string; priceClp: number; status: string; paymentStatus: string };

export default function PaymentDemoClient({ caseId }: { caseId: string }) {
  const [contract, setContract] = useState<DemoContract>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!caseId) return;
    fetch(`/api/cases/${encodeURIComponent(caseId)}/contract`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.contract) throw new Error(payload.error || "No se pudo cargar el pago");
        setContract(payload.contract as DemoContract);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar el pago"));
  }, [caseId]);

  async function simulatePayment() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/contract/payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ demo: true }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.paid) throw new Error(payload.error || "No se pudo registrar el pago de prueba");
      setDone(true);
      setContract((current) => current ? { ...current, status: "paid_demo", paymentStatus: "paid_demo" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo registrar el pago de prueba");
    } finally { setBusy(false); }
  }

  if (!caseId) return <main className="payment-demo-page"><section className="payment-demo-card"><div className="portal-brand"><span>R</span> Rakun</div><h1>Enlace de pago no válido</h1><p>Vuelve al expediente para generar un enlace de prueba.</p><a className="portal-button portal-button-primary" href="/?view=patient">Volver al expediente</a></section></main>;
  return <main className="payment-demo-page"><section className="payment-demo-card"><div className="portal-brand"><span>R</span> Rakun</div><span className="card-kicker">PAGO DE DEMOSTRACIÓN</span><h1>{done ? "Pago de prueba registrado" : "Confirma tu asesoría"}</h1>{error && <p className="contract-error" role="alert">{error}</p>}{contract ? <><div className="payment-demo-summary"><span><b>Paciente</b>{contract.patientName}</span><span><b>Servicio</b>Revisión y gestión administrativa</span><span><b>Total piloto</b>${contract.priceClp.toLocaleString("es-CL")} CLP</span></div><div className="contract-notice"><b>Sin cobro real</b><span>Este enlace es ficticio mientras se integra Webpay. No ingreses datos bancarios.</span></div>{done ? <div className="payment-demo-success"><b>✓ Listo</b><span>El flujo de prueba quedó registrado. Puedes volver a tu expediente.</span></div> : <button className="portal-button portal-button-primary payment-demo-button" onClick={() => void simulatePayment()} disabled={busy}>{busy ? "Registrando…" : "Simular pago aprobado"} →</button>}</> : <p className="payment-demo-loading">Cargando el detalle del contrato…</p>}<a className="back-link" href={`/?view=patient&case=${encodeURIComponent(caseId)}`}>← Volver al expediente</a></section></main>;
}
