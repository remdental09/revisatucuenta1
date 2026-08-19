"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { extractHealthcareDocument } from "../lib/extraction/client";
import type { DocumentExtraction } from "../lib/extraction/types";
import {
  analyzeClinicalAccount,
  type ChileanBillingLine,
  type ClinicalAccountAnalysis,
} from "../lib/rules/chilean-account";

const money = (value: number) =>
  `$${value.toLocaleString("es-CL", { maximumFractionDigits: 0 })}`;

const PAM_STORAGE_KEY = "rtc:pam:D1305597-1";
const ANALYSIS_STORAGE_KEY = "rtc:analysis:D1305597-1";
const CLAIM_AUTH_STORAGE_KEY = "rtc:claim-authorization:D1305597-1";
type PamSummary = { name: string; status: string; progress: number; lines: number; fields: number };
type ClaimAuthorization = { authorized: boolean; at: string; scope: string };

type PatientTab = "Resumen" | "Documentos" | "Actividad";
type PatientAnalysisStatus = "idle" | "running" | "complete" | "error";

const SANTIAGO_ACCOUNT_TOTAL = 23834903;

/**
 * Representative lines from the 18-page account. They are deliberately kept
 * as account evidence, separate from the PAM facts below, so the patient can
 * see what the motor is comparing without treating the two documents as one.
 */
const SANTIAGO_ACCOUNT_LINES: ChileanBillingLine[] = [
  { id: "santiago-cama-mq", description: "Día cama pieza exclusiva medicina y cirugía (MQ)", amount: 770097, page: 1, code: "202913", section: "Hospitalización transitoria", date: "21/06/2023", documentId: "D1305597-1" },
  { id: "santiago-cama-uti", description: "Día-cama U.T.I. pediátrica (UCI)", amount: 1014471, page: 1, code: "202957", section: "Día cama U.T.I. pediátrica", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-cama-intermedio-18", description: "Día cama unidad intermedio pediátrico (UTI)", amount: 907622, page: 1, code: "202955", section: "Día cama unidad intermedio pediátrico", date: "18/06/2023", documentId: "D1305597-1" },
  { id: "santiago-cama-intermedio-19", description: "Día cama unidad intermedio pediátrico (UTI)", amount: 907622, page: 1, code: "202955", section: "Día cama unidad intermedio pediátrico", date: "19/06/2023", documentId: "D1305597-1" },
  { id: "santiago-cama-intermedio-20", description: "Día cama unidad intermedio pediátrico (UTI)", amount: 907622, page: 1, code: "202955", section: "Día cama unidad intermedio pediátrico", date: "20/06/2023", documentId: "D1305597-1" },
  { id: "santiago-procedure", description: "Tumor y/o quiste intracraneano c/neuronavegador", amount: 5054240, page: 1, code: "330105", section: "Pabellón cirugía", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-flapfix", description: "25-302-10-71 Neuro FlapFix kit", amount: 594204, page: 3, code: "600760369", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-bipolar", description: "Pinza bipolar desechable 18cm x 0.5mm", amount: 282100, page: 3, code: "600590004", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-lonestar", description: "Set de retracción Lonestar 3304/3311", amount: 210105, page: 3, code: "600591776", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-surgiflo", description: "Surgiflo hemostático 8ml", amount: 478500, page: 3, code: "600593781", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-kinevo", description: "Funda protectora para Kinevo 900-700", amount: 72660, page: 3, code: "601582263", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-navigation", description: "Esferas paquetes 5 un", amount: 393714, page: 3, code: "600510352", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-surgicel", description: "Surgicel fibrilar 2.5x5cms", amount: 189920, page: 4, code: "600510365", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-fresa-a", description: "Fresa A para adaptador 1.5", amount: 329525, page: 7, code: "600542723", section: "Materiales clínicos", date: "22/06/2023", documentId: "D1305597-1" },
  { id: "santiago-fresa-b", description: "Fresa bell para adaptador 7.5", amount: 329525, page: 7, code: "600542727", section: "Materiales clínicos", date: "22/06/2023", documentId: "D1305597-1" },
  { id: "santiago-thermometer", description: "Termómetro digital flexible", amount: 3408, page: 11, code: "600510115", section: "Materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-propofol", description: "Propofol kit 1% 100 ml inyectable", amount: 43350, page: 2, code: "500507248", section: "Fármacos materiales clínicos", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-sevoflurane", description: "Sevoflurano líquido inhalación 250 ml", amount: 178560, page: 3, code: "500507821", section: "Fármacos materiales clínicos", date: "22/06/2023", documentId: "D1305597-1" },
  { id: "santiago-honorary-surgery", description: "Tumores y/o quistes y/o cavernoma: de base de cráneo", amount: 4232656, page: 16, code: "1103024", section: "Honorario quirúrgico", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-honorary-anesthesia", description: "Valor arancelario anestésico 9 (nueve)", amount: 1482037, page: 17, code: "2201009", section: "Honorario quirúrgico", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-lab", description: "Hemograma", amount: 43346, page: 15, code: "824590", section: "Laboratorio clínico", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-ct", description: "Scanner cerebro doble", amount: 530712, page: 18, code: "567038", section: "Tomografía", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-fluoroscopy", description: "Radioscopia apoyo fluoroscópico a procedimientos intraoperatorios", amount: 126102, page: 18, code: "637001", section: "Rayos X pabellón", date: "17/06/2023", documentId: "D1305597-1" },
  { id: "santiago-no-bonus", description: "Prestaciones sin bonificación", amount: 66752, page: 11, code: "3101306", section: "Ajustes", date: "17/06/2023", documentId: "D1305597-1" },
];

const SANTIAGO_PAM_FACTS = {
  pages: 13,
  distinctBonos: 12,
  documentedValue: 26454577,
  bonus: 5959464,
  copay: 20495113,
  duplicatePages: "9–10",
};

const SANTIAGO_PRESUMPTIVE_RECOVERABLE = 2950413;

type PatientReviewRow = {
  description: string;
  amount: number;
  page: number;
  category: string;
  probability: number;
  reason: string;
};

const SANTIAGO_REVIEW_ROWS: PatientReviewRow[] = [
  { description: "Tumor/quiste intracraneano c/neuronavegador", amount: 5054240, page: 1, category: "Derecho de Pabellón / Procedimiento", probability: 0.96, reason: "Prestación principal que debe vincularse con pabellón, honorarios y materiales." },
  { description: "Honorario quirúrgico de base de cráneo", amount: 4232656, page: 16, category: "Honorarios Médicos Quirúrgicos", probability: 0.93, reason: "Glosa y código coinciden con el acto quirúrgico informado en la cuenta." },
  { description: "Día cama pieza exclusiva (MQ)", amount: 770097, page: 1, category: "Día Cama u Hospitalización Transitoria", probability: 0.86, reason: "La línea identifica directamente una modalidad de hospitalización." },
  { description: "Día cama U.T.I. pediátrica", amount: 1014471, page: 1, category: "Día Cama Intensivos / Intermedios", probability: 0.88, reason: "La glosa identifica unidad crítica; se debe verificar periodo y convenio aplicable." },
  { description: "FlapFix kit", amount: 594204, page: 3, category: "Materiales e Insumos Clínicos", probability: 0.62, reason: "Material quirúrgico especial asociado al acto; falta saber si el convenio lo separa del pabellón." },
  { description: "Pinza bipolar desechable", amount: 282100, page: 3, category: "Materiales e Insumos Clínicos", probability: 0.61, reason: "Consumible funcional de cirugía; requiere regla contractual y respaldo de uso." },
  { description: "Set de retracción Lonestar", amount: 210105, page: 3, category: "Materiales e Insumos Clínicos", probability: 0.60, reason: "Insumo de apoyo quirúrgico presentado fuera de la prestación principal." },
  { description: "Surgiflo hemostático", amount: 478500, page: 3, category: "Materiales e Insumos Clínicos", probability: 0.60, reason: "Material hemostático vinculado al procedimiento; su inclusión económica no queda demostrada solo por la glosa." },
  { description: "Esferas de navegación", amount: 393714, page: 3, category: "Materiales e Insumos Clínicos", probability: 0.64, reason: "Elemento específico de neuronavegación; debe trazarse al procedimiento y al convenio." },
  { description: "Fresas quirúrgicas", amount: 659050, page: 7, category: "Materiales e Insumos Clínicos", probability: 0.63, reason: "Dos líneas de instrumental consumible relacionadas con la cirugía." },
  { description: "Termómetro digital flexible", amount: 3408, page: 11, category: "Materiales e Insumos Clínicos", probability: 0.38, reason: "Artículo de hospitalización cuya pertenencia a día cama o cobro separado no se desprende de la cuenta." },
  { description: "Prestaciones sin bonificación", amount: 66752, page: 11, category: "Ajustes / Otros conceptos", probability: 0.48, reason: "La cuenta agrupa un monto sin explicar qué prestaciones contiene ni por qué no fue bonificado." },
  { description: "Scanner cerebro doble", amount: 530712, page: 18, category: "Imagenología", probability: 0.92, reason: "Prestación de imagenología identificada por código y glosa." },
];

export function PortalEntry() {
  return (
    <main className="portal-entry">
      <div className="portal-entry-glow" />
      <div className="portal-entry-card">
        <div className="portal-brand"><span>R</span> RevisaTuCuenta</div>
        <p className="portal-kicker">Portal de casos clínicos</p>
        <h1>Una cuenta clara empieza por un expediente ordenado.</h1>
        <p className="portal-entry-copy">
          Accede a la vista que necesitas. La información de la cuenta clínica y
          la del PAM se mantienen separadas para que cada documento conserve su
          origen.
        </p>
        <div className="portal-entry-actions">
          <a className="portal-button portal-button-primary" href="/?view=patient">
            <span className="googleMark">G</span>
            Ingresar como paciente
          </a>
          <a className="portal-button portal-button-secondary" href="/?view=developer">
            Abrir consola de desarrollo <span>↗</span>
          </a>
        </div>
        <div className="portal-entry-foot"><span>●</span> Entorno local de demostración</div>
      </div>
    </main>
  );
}

export function PatientPortal() {
  // En el entorno local se entra directamente con la cuenta demo del caso
  // seleccionado; la autenticación real de Google se conectará después.
  const [authenticated, setAuthenticated] = useState(true);
  const [tab, setTab] = useState<PatientTab>("Resumen");
  const [toast, setToast] = useState("");
  const [pamFileName, setPamFileName] = useState("");
  const [pamStatus, setPamStatus] = useState("Pendiente");
  const [pamProgress, setPamProgress] = useState(0);
  const [pamExtraction, setPamExtraction] = useState<DocumentExtraction>();
  const [pamLineCount, setPamLineCount] = useState(0);
  const [pamFieldCount, setPamFieldCount] = useState(0);
  const [pamProcessing, setPamProcessing] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<PatientAnalysisStatus>("idle");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState("Esperando el PAM");
  const [analysisError, setAnalysisError] = useState("");
  const [claimAuthorized, setClaimAuthorized] = useState(false);
  const pamInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PAM_STORAGE_KEY) || "null") as PamSummary | null;
      if (!saved) return;
      setPamFileName(saved.name);
      setPamStatus(saved.status);
      setPamProgress(saved.progress);
      setPamLineCount(saved.lines);
      setPamFieldCount(saved.fields);
    } catch {
      /* El flujo sigue disponible aunque el almacenamiento local esté bloqueado. */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CLAIM_AUTH_STORAGE_KEY) || "null") as ClaimAuthorization | null;
      setClaimAuthorized(Boolean(saved?.authorized));
    } catch {
      setClaimAuthorized(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(ANALYSIS_STORAGE_KEY) || "null") as ClinicalAccountAnalysis | null;
      if (!saved?.lineAssessments?.length) return;
      setAnalysisStarted(true);
      setAnalysisProgress(100);
      setAnalysisStage("Resultado disponible para revisión");
      setAnalysisStatus("complete");
    } catch {
      /* El análisis puede volver a ejecutarse si el almacenamiento no está disponible. */
    }
  }, []);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function handlePamChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPamFileName(file.name);
    setPamStatus("Analizando PAM · 0%");
    setPamProgress(0);
    setPamExtraction(undefined);
    setPamLineCount(0);
    setPamFieldCount(0);
    setPamProcessing(true);
    setAnalysisStarted(false);
    setAnalysisStatus("idle");
    setAnalysisProgress(0);
    setAnalysisStage("Esperando el PAM");
    setAnalysisError("");
    window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
    window.localStorage.setItem(PAM_STORAGE_KEY, JSON.stringify({ name: file.name, status: "Analizando PAM · 0%", progress: 0, lines: 0, fields: 0 } satisfies PamSummary));
    try {
      const body = new FormData();
      body.append("caseId", "D1305597-1");
      body.append("documentId", "pam-santiago-demo");
      body.append("classification", "PAM / liquidación");
      body.append("confidence", "1");
      body.append("file", file);
      const uploadPromise = fetch("/api/documents", { method: "POST", body }).catch(() => undefined);
      const extraction = await extractHealthcareDocument(file, "pam", (progress) => {
        setPamProgress(progress);
        setPamStatus(`Analizando PAM · ${progress}%`);
      });
      const response = await uploadPromise;
      if (response?.ok) {
        await fetch("/api/extractions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentId: "pam-santiago-demo", extraction }),
        }).catch(() => undefined);
      }
      setPamExtraction(extraction);
      const lineCount = extraction.pam?.lines.length ?? 0;
      const fieldCount = extraction.pam?.fields.length ?? 0;
      setPamLineCount(lineCount);
      setPamFieldCount(fieldCount);
      setPamProgress(100);
      const finalStatus = `PAM clasificado · ${lineCount} líneas`;
      setPamStatus(finalStatus);
      window.localStorage.setItem(PAM_STORAGE_KEY, JSON.stringify({ name: file.name, status: finalStatus, progress: 100, lines: lineCount, fields: fieldCount } satisfies PamSummary));
      showToast("PAM cargado y clasificado por separado");
    } catch {
      setPamStatus("Recibido · requiere revisión de extracción");
      window.localStorage.setItem(PAM_STORAGE_KEY, JSON.stringify({ name: file.name, status: "Recibido · requiere revisión de extracción", progress: pamProgress, lines: 0, fields: 0 } satisfies PamSummary));
      showToast("PAM recibido; la extracción requiere revisión");
    } finally {
      setPamProcessing(false);
    }
  }

  function openPamPicker() {
    pamInputRef.current?.click();
  }

  function authorizeClaims() {
    const authorization: ClaimAuthorization = {
      authorized: true,
      at: new Date().toISOString(),
      scope: "Preparar y presentar solicitudes de aclaración y reclamos ante el prestador de salud; sin aceptar acuerdos ni recibir fondos en nombre del paciente.",
    };
    setClaimAuthorized(true);
    window.localStorage.setItem(CLAIM_AUTH_STORAGE_KEY, JSON.stringify(authorization));
    showToast("Autorización registrada para preparar los reclamos");
  }

  async function startPatientAnalysis() {
    if (analysisStatus === "running" || analysisStatus === "complete") return;
    setAnalysisStarted(true);
    setAnalysisStatus("running");
    setAnalysisError("");
    const phases = [
      [12, "Separando cuenta clínica y PAM"],
      [28, "Leyendo prestaciones, códigos y montos"],
      [48, "Clasificando líneas por rubro"],
      [72, "Comparando glosas con el PAM"],
      [88, "Detectando anomalías documentales"],
    ] as const;
    for (const [progress, stage] of phases) {
      setAnalysisProgress(progress);
      setAnalysisStage(stage);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
    }
    let result: ClinicalAccountAnalysis;
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: SANTIAGO_ACCOUNT_LINES }),
      });
      if (!response.ok) throw new Error("El motor local no respondió");
      result = (await response.json()) as ClinicalAccountAnalysis;
    } catch {
      // Mantiene la vista operativa si la API todavía está reiniciándose.
      result = analyzeClinicalAccount(SANTIAGO_ACCOUNT_LINES);
      setAnalysisError("Resultado disponible para revisión; la sincronización del expediente queda pendiente.");
    }
    window.localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(result));
    setAnalysisProgress(100);
    setAnalysisStage("Resultado disponible para revisión");
    setAnalysisStatus("complete");
    showToast("Análisis listo: cuenta y PAM se mantienen separados");
  }

  if (!authenticated) {
    return (
      <main className="patient-login">
        <div className="patient-login-card">
          <div className="portal-brand"><span>R</span> RevisaTuCuenta</div>
          <div className="login-seal">⌁</div>
          <p className="portal-kicker">Acceso del paciente</p>
          <h1>Continúa con tu cuenta Google.</h1>
          <p>Usaremos tu correo sólo para mostrar tus expedientes en este entorno de prueba.</p>
          <button className="portal-button portal-button-primary login-google" onClick={() => setAuthenticated(true)}>
            <span className="googleMark">G</span>
            Continuar con Google
          </button>
          <div className="login-account-preview"><span className="avatar avatar-small">SR</span><div><b>santiago.demo@gmail.com</b><small>Cuenta de demostración · Caso Santiago</small></div><span>›</span></div>
          <a className="back-link" href="/">← Volver</a>
        </div>
      </main>
    );
  }

  return (
    <main className="patient-portal">
      <header className="patient-topbar">
        <a className="portal-brand" href="/"><span>R</span> RevisaTuCuenta</a>
        <div className="patient-topbar-right"><span className="surface-pill patient-pill">Vista paciente</span><span className="avatar">SR</span><span className="patient-email">santiago.demo@gmail.com</span><a href="/?view=developer" target="_blank" rel="noreferrer" className="developer-link">Abrir otra vista ↗</a></div>
      </header>
      <div className="patient-layout">
        <aside className="patient-sidebar">
          <div className="case-mini"><span className="case-icon">⌁</span><div><small>CASO ACTIVO</small><b>Santiago Riquelme P.</b><span>Cuenta D1305597-1</span></div></div>
          <nav className="patient-nav" aria-label="Navegación del paciente">
            {(["Resumen", "Documentos", "Actividad"] as PatientTab[]).map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>{item === "Resumen" ? "⌂" : item === "Documentos" ? "▤" : "◷"}</span>{item}</button>
            ))}
          </nav>
          <div className="patient-sidebar-help"><span>?</span><div><b>¿Necesitas ayuda?</b><small>Escríbenos sobre tu caso.</small></div></div>
        </aside>
        <section className="patient-main">
          <div className="patient-heading"><div><p className="portal-kicker">Mi expediente</p><h1>Hola, Santiago.</h1><p>Este es el estado de la revisión de tu atención en Clínica Alemana de Santiago.</p></div><span className="case-status"><i /> En revisión</span></div>
          {tab === "Resumen" && <PatientSummary onRequest={() => showToast("Solicitud preparada para revisión")} onPamUpload={openPamPicker} onNext={startPatientAnalysis} onAuthorizeClaims={authorizeClaims} claimAuthorized={claimAuthorized} analysisStarted={analysisStarted} analysisStatus={analysisStatus} analysisProgress={analysisProgress} analysisStage={analysisStage} analysisError={analysisError} pamFileName={pamFileName} pamStatus={pamStatus} pamProgress={pamProgress} pamExtraction={pamExtraction} pamProcessing={pamProcessing}/>} 
          {tab === "Documentos" && <PatientDocuments onRequest={() => showToast("Solicitud preparada para revisión")} onPamUpload={openPamPicker} pamFileName={pamFileName} pamStatus={pamStatus}/>} 
          {tab === "Actividad" && <PatientActivity />}
        </section>
      </div>
      <input ref={pamInputRef} type="file" accept="application/pdf,.pdf,image/jpeg,image/png" hidden onChange={handlePamChange}/>
      {toast && <div className="portal-toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function PatientSummary({ onRequest, onPamUpload, onNext, onAuthorizeClaims, claimAuthorized, analysisStarted, analysisStatus, analysisProgress, analysisStage, analysisError, pamFileName, pamStatus, pamProgress, pamExtraction, pamProcessing }: { onRequest: () => void; onPamUpload: () => void; onNext: () => void; onAuthorizeClaims: () => void; claimAuthorized: boolean; analysisStarted: boolean; analysisStatus: PatientAnalysisStatus; analysisProgress: number; analysisStage: string; analysisError: string; pamFileName: string; pamStatus: string; pamProgress: number; pamExtraction?: DocumentExtraction; pamProcessing: boolean }) {
  const pamReady = Boolean(pamFileName) && !pamProcessing && !pamStatus.startsWith("Analizando");
  return (
    <>
      <div className="patient-metrics">
        <article className="patient-metric-card accent"><div className="metric-top"><span>CUENTA CLÍNICA</span><b>✓</b></div><strong>{money(23834903)}</strong><small>Recibida · 18 páginas</small><div className="metric-bar"><i style={{ width: "100%" }} /></div><em>Documento disponible</em></article>
        <article className="patient-metric-card"><div className="metric-top"><span>PAM / LIQUIDACIÓN</span><b>02</b></div><strong className={pamFileName ? "" : "pending-value"}>{pamFileName ? "Recibido" : "Pendiente"}</strong><small>{pamFileName ? pamFileName : "La liquidación permite completar el contraste financiero."}</small><button onClick={onPamUpload} className="inline-action">{pamFileName ? "Reemplazar PAM" : "Agregar PAM"} <span>→</span></button></article>
        <article className="patient-metric-card"><div className="metric-top"><span>CONTRATO / PLAN</span><b>03</b></div><strong className="pending-value">Pendiente</strong><small>Se incorporará para vincular cada cargo con su cobertura.</small><button onClick={onRequest} className="inline-action">Agregar contrato <span>→</span></button></article>
      </div>
      <DocumentProcessingPanel pamFileName={pamFileName} pamStatus={pamStatus} pamProgress={pamProgress} pamExtraction={pamExtraction} pamProcessing={pamProcessing}/>
      {analysisStatus !== "idle" && <PatientAnalysisPanel status={analysisStatus} progress={analysisProgress} stage={analysisStage} notice={analysisError} pamReady={pamReady} claimAuthorized={claimAuthorized} onAuthorizeClaims={onAuthorizeClaims}/>} 
      <div className="patient-grid">
        <section className="patient-card episode-card"><div className="card-heading"><div><span className="card-kicker">FLUJO DEL EPISODIO</span><h2>Tu revisión, paso a paso</h2></div><span className="progress-label">{analysisStatus === "complete" ? "3 de 4" : "2 de 4"}</span></div><div className="patient-timeline"><TimelineItem done title="Cuenta clínica recibida" text="La cuenta quedó ordenada por documento y fecha." /><TimelineItem done={analysisStatus === "complete"} current={analysisStatus !== "complete"} title={analysisStatus === "complete" ? "Clasificación de cargos" : "Clasificación de cargos"} text={analysisStatus === "complete" ? "Las líneas prioritarias quedaron vinculadas a rubros de revisión." : "Pulsa Siguiente para relacionar cada línea con su prestación."} /><TimelineItem done={pamReady} current={!pamReady} title="PAM y contrato" text={pamReady ? "PAM incorporado; el contrato queda para una etapa posterior." : "Agrega el PAM para completar el contraste."} /><TimelineItem title="Preinforme" text="Recibirás el mapa de revisión del episodio." /></div></section>
        <section className="patient-card next-card"><span className="card-kicker">SIGUIENTE PASO</span><div className="next-icon">↑</div><h2>{analysisStatus === "complete" ? "Análisis disponible" : analysisStarted ? "Clasificación en curso" : pamReady ? "Continúa con el análisis" : "Completa tu expediente"}</h2><p>{analysisStatus === "complete" ? "Ya puedes revisar qué proviene de la cuenta, qué informa el PAM y qué líneas requieren aclaración." : analysisStarted ? "Estamos relacionando las líneas de la cuenta con las líneas del PAM, manteniendo cada documento separado." : "Con el PAM podremos mostrar por separado lo facturado, lo bonificado y lo que quedó pendiente de revisar."}</p>{pamReady ? <button onClick={onNext} disabled={analysisStarted} className="portal-button portal-button-primary">{analysisStatus === "complete" ? "Análisis completado" : analysisStarted ? "Analizando…" : "Siguiente"} <span>→</span></button> : <button onClick={onPamUpload} disabled={pamProcessing} className="portal-button portal-button-primary">{pamProcessing ? "Analizando PAM…" : pamFileName ? "Reemplazar PAM" : "Agregar PAM"} <span>→</span></button>}<small>{pamStatus} · PDF, JPG o PNG · hasta 20 MB</small></section>
      </div>
      <section className="patient-card trace-card"><div className="trace-copy"><span className="card-kicker">ORDEN Y TRAZABILIDAD</span><h2>Cada cifra conserva su documento de origen.</h2><p>Tu expediente separa la cuenta clínica del PAM para que puedas revisar qué dice cada documento antes de avanzar.</p></div><div className="trace-stack"><div><span className="doc-chip clinic-chip">CLÍNICA</span><b>Cuenta clínica</b><small>18 páginas · recibida</small></div><div><span className="doc-chip pam-chip">PAM</span><b>Liquidación</b><small>{pamFileName ? pamStatus : "Pendiente de carga"}</small></div></div></section>
    </>
  );
}

function PatientAnalysisPanel({ status, progress, stage, notice, pamReady, claimAuthorized, onAuthorizeClaims }: { status: PatientAnalysisStatus; progress: number; stage: string; notice: string; pamReady: boolean; claimAuthorized: boolean; onAuthorizeClaims: () => void }) {
  const phases = [
    ["Cuenta clínica", progress >= 12],
    ["Clasificación", progress >= 48],
    ["Cruce con PAM", progress >= 72],
    ["Resultado", status === "complete"],
  ] as const;
  return (
    <section className="patient-card patient-analysis-card">
      <div className="card-heading"><div><span className="card-kicker">RESULTADO DEL MOTOR</span><h2>Cuenta y PAM, analizados por separado</h2></div><span className={`patient-analysis-status ${status}`}>{status === "running" ? `${progress}%` : status === "complete" ? "Listo" : "Preparando"}</span></div>
      {status === "running" && <><div className="patient-analysis-progress-meta"><span>{stage}</span><b>{progress}%</b></div><div className="patient-analysis-progress"><i style={{ width: `${progress}%` }} /></div><div className="patient-analysis-phases">{phases.map(([label, done]) => <span className={done ? "done" : ""} key={label}>{done ? "✓" : "○"} {label}</span>)}</div></>}
      {status === "complete" && <>
        <div className="patient-analysis-flow">{phases.map(([label, done], index) => <div key={label} className={done ? "done" : ""}><span>{done ? "✓" : index + 1}</span><b>{label}</b><small>{done ? "Completado" : "Pendiente"}</small></div>)}</div>
        <div className="patient-analysis-metrics patient-limited-metrics"><article><span>TOTAL DE LA CUENTA</span><strong>{money(SANTIAGO_ACCOUNT_TOTAL)}</strong><small>Cuenta clínica recibida</small></article><article><span>DOCUMENTACIÓN PENDIENTE</span><strong>{money(SANTIAGO_PAM_FACTS.documentedValue - SANTIAGO_ACCOUNT_TOTAL)}</strong><small>Requiere aclaración documental</small></article><article><span>ESTADO DEL PAM</span><strong>{pamReady ? "Recibido" : "Pendiente"}</strong><small>Documento separado de la cuenta</small></article></div>
        <div className="patient-analysis-sources patient-limited-sources"><article><div><span className="doc-chip clinic-chip">CUENTA</span><b>Cuenta clínica</b><small>18 páginas · documento recibido</small></div><em>Disponible</em></article><article><div><span className="doc-chip pam-chip">PAM</span><b>Liquidación de Isapre</b><small>{pamReady ? `${SANTIAGO_PAM_FACTS.pages} páginas · recibida` : "Aún no incorporada"}</small></div><em>{pamReady ? "Disponible" : "Pendiente"}</em></article></div>
        <section className="patient-recovery-card"><div><span className="card-kicker">RESULTADO PRELIMINAR</span><h3>Monto presumiblemente recuperable</h3><strong>{money(SANTIAGO_PRESUMPTIVE_RECOVERABLE)}</strong><p>Estimación inicial de líneas sujetas a aclaración y eventual reclamo. No constituye una devolución garantizada.</p></div>{claimAuthorized ? <div className="patient-authorization-confirmed"><b>Autorización registrada</b><small>RevisaTuCuenta puede preparar y presentar los reclamos pertinentes ante el prestador.</small></div> : <><button className="portal-button portal-button-primary" onClick={onAuthorizeClaims}>Autorizar gestión de reclamos <span>→</span></button><small className="patient-authorization-scope">Al autorizar, permites gestionar solicitudes de aclaración y reclamos ante el prestador. No se aceptarán acuerdos ni se recibirán fondos en tu nombre sin una autorización adicional.</small></>}</section>
        <div className="patient-analysis-warning"><span>!</span><div><b>Hay un monto documental que debe aclararse</b><p>El sistema detectó una diferencia entre los documentos por {money(SANTIAGO_PAM_FACTS.documentedValue - SANTIAGO_ACCOUNT_TOTAL)}. Este valor no es una devolución confirmada ni un monto recuperable automático. Para conocer su composición se debe solicitar una cuenta trazable.</p></div></div>
        <p className="patient-analysis-disclaimer">Este resumen está limitado a los datos principales del episodio. El detalle de líneas, probabilidades, páginas y reglas queda reservado para la revisión técnica.</p>
      </>}
      {status === "error" && <div className="patient-analysis-warning"><span>!</span><div><b>No se pudo completar el análisis</b><p>La cuenta permanece disponible y puede intentarse nuevamente.</p></div></div>}
      {!!notice && <p className="patient-analysis-notice">{notice}</p>}
    </section>
  );
}

function DocumentProcessingPanel({ pamFileName, pamStatus, pamProgress, pamExtraction, pamProcessing }: { pamFileName: string; pamStatus: string; pamProgress: number; pamExtraction?: DocumentExtraction; pamProcessing: boolean }) {
  return <section className="patient-card document-processing-card"><div className="card-heading"><div><span className="card-kicker">ANÁLISIS SEPARADO</span><h2>Cuenta clínica y PAM</h2></div><span className="progress-label">No se mezclan los documentos</span></div><div className="analysis-sources"><article className="analysis-source"><div className="analysis-source-head"><div><b>Cuenta clínica</b><small>Clínica Alemana · D1305597-1</small></div><em className="analysis-done">Recibida</em></div><div className="analysis-bar"><i style={{ width: "100%" }}/></div><p>Documento recibido y conservado como fuente independiente.</p></article><article className="analysis-source"><div className="analysis-source-head"><div><b>PAM / liquidación</b><small>{pamFileName || "Aún no cargado"}</small></div><em className={pamProcessing ? "analysis-working" : pamExtraction ? "analysis-done" : "analysis-pending"}>{pamProcessing ? `${pamProgress}%` : pamExtraction ? "Recibido" : "Pendiente"}</em></div><div className="analysis-bar"><i style={{ width: `${pamExtraction ? 100 : pamProgress}%` }}/></div><p>{pamExtraction ? "Documento recibido y separado de la cuenta clínica." : pamStatus}</p></article></div></section>;
}

function PatientDocuments({ onRequest, onPamUpload, pamFileName, pamStatus }: { onRequest: () => void; onPamUpload: () => void; pamFileName: string; pamStatus: string }) {
  return <section className="patient-card documents-view"><div className="card-heading"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h2>Cuenta y PAM, por separado</h2></div><button onClick={onPamUpload} className="portal-button portal-button-primary">{pamFileName ? "Reemplazar PAM" : "Agregar PAM"} <span>+</span></button></div><div className="document-list"><PatientDocument name="Cuenta Paciente - Detalle - D1305597_1 (1).pdf" type="Cuenta clínica" detail="18 páginas · recibida" status="Disponible" kind="clinic" /><PatientDocument name={pamFileName || "PAM / liquidación"} type={pamFileName ? "PAM / liquidación" : "Documento pendiente"} detail={pamFileName ? pamStatus : "Agrega la liquidación de tu Isapre"} status={pamFileName ? "Recibido" : "Pendiente"} kind="pam" onAdd={onPamUpload} /></div><div className="document-tip"><span>i</span><p>La cuenta clínica muestra los cargos del prestador. El PAM muestra la liquidación de cobertura. Cada documento mantiene su origen.</p></div></section>;
}

function PatientDocument({ name, type, detail, status, kind, onAdd }: { name: string; type: string; detail: string; status: string; kind: "clinic" | "pam"; onAdd?: () => void }) {
  return <article className={`patient-document ${kind}`}><span className="file-mark">{kind === "clinic" ? "PDF" : "+"}</span><div><span>{type}</span><b>{name}</b><small>{detail}</small></div><div className="document-status"><em>{status}</em>{onAdd && <button onClick={onAdd}>Cargar</button>}</div></article>;
}

function PatientActivity() {
  return <section className="patient-card activity-view"><span className="card-kicker">ACTIVIDAD</span><h2>Movimientos del expediente</h2><div className="activity-list"><ActivityItem date="18 ago 2026 · 11:42" title="Cuenta clínica incorporada" text="El documento quedó disponible para revisión." /><ActivityItem date="18 ago 2026 · 11:44" title="Caso creado" text="Se abrió el expediente de Santiago Riquelme P." /><ActivityItem date="Siguiente paso" title="Agregar PAM" text="La liquidación permite completar el contraste financiero." pending /></div></section>;
}

function TimelineItem({ done, current, title, text }: { done?: boolean; current?: boolean; title: string; text: string }) { return <div className={`timeline-item ${done ? "done" : ""} ${current ? "current" : ""}`}><span className="timeline-dot">{done ? "✓" : current ? "•" : ""}</span><div><b>{title}</b><small>{text}</small></div></div>; }
function ActivityItem({ date, title, text, pending }: { date: string; title: string; text: string; pending?: boolean }) { return <div className={`activity-item ${pending ? "pending" : ""}`}><span className="activity-dot" /><div><small>{date}</small><b>{title}</b><p>{text}</p></div></div>; }

export function DeveloperPortal() {
  const [selectedCase, setSelectedCase] = useState("D1305597-1");
  const [devTab, setDevTab] = useState<"overview" | "traceability" | "documents">("overview");
  const [pamSummary, setPamSummary] = useState<PamSummary>();
  const [storedAnalysis, setStoredAnalysis] = useState<ClinicalAccountAnalysis>();
  const [claimAuthorization, setClaimAuthorization] = useState<ClaimAuthorization>();
  const [documentNames, setDocumentNames] = useState<Record<string, string>>({
    "1482290-1": "Cuenta Paciente - Detalle - 1482290-1.pdf",
    "D1305597-1": "Cuenta Paciente - Detalle - D1305597_1 (1).pdf",
  });
  useEffect(() => {
    const readCaseState = () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(PAM_STORAGE_KEY) || "null") as PamSummary | null;
        setPamSummary(saved || undefined);
        const analysis = JSON.parse(window.localStorage.getItem(ANALYSIS_STORAGE_KEY) || "null") as ClinicalAccountAnalysis | null;
        setStoredAnalysis(analysis?.lineAssessments?.length ? analysis : undefined);
        const authorization = JSON.parse(window.localStorage.getItem(CLAIM_AUTH_STORAGE_KEY) || "null") as ClaimAuthorization | null;
        setClaimAuthorization(authorization?.authorized ? authorization : undefined);
      } catch {
        setPamSummary(undefined);
        setStoredAnalysis(undefined);
        setClaimAuthorization(undefined);
      }
    };
    readCaseState();
    window.addEventListener("storage", readCaseState);
    return () => window.removeEventListener("storage", readCaseState);
  }, []);
  const selected = selectedCase === "1482290-1" ? { patient: "Antonia Renata L.", account: "1482290-1", provider: "Clínica Alemana · Vitacura", total: 7293388, status: "En clasificación", initials: "AL", docs: "1 / 3" } : { patient: "Caso Santiago", account: "D1305597-1", provider: "Clínica Alemana · Santiago", total: 23834903, status: "Cuenta recibida", initials: "CS", docs: "1 / 3" };
  const caseAnalysis = selectedCase === "D1305597-1" ? storedAnalysis : undefined;
  const caseClaimAuthorized = selectedCase === "D1305597-1" && Boolean(claimAuthorization?.authorized);
  return <main className="developer-portal"><aside className="developer-sidebar"><a className="portal-brand dev-brand" href="/"><span>R</span> RevisaTuCuenta</a><div className="dev-workspace-label">ESPACIO DE TRABAJO</div><nav className="dev-nav"><a className="active" href="/?view=developer"><span>▦</span> Expedientes <em>12</em></a><a href="/?view=developer"><span>◌</span> Reglas del motor</a><a href="/?view=developer"><span>⌁</span> Corpus observado</a><a href="/?view=developer"><span>↗</span> Informes enviados</a></nav><div className="dev-sidebar-bottom"><a href="/?view=patient" target="_blank" rel="noreferrer"><span>↗</span> Vista paciente</a><div className="dev-user"><span className="avatar">LR</span><div><b>Desarrollador</b><small>Entorno local</small></div><span>•••</span></div></div></aside><section className="developer-main"><header className="developer-header"><div><p className="portal-kicker">CONSOLa DE DESARROLLO</p><h1>Expedientes</h1><p>Controla la separación entre cuenta clínica, PAM y trazabilidad contractual.</p></div><div className="developer-header-actions"><span className="surface-pill developer-pill">Vista desarrollador</span><a className="portal-button portal-button-secondary" href="/?view=patient" target="_blank" rel="noreferrer">Abrir vista paciente ↗</a></div></header><div className="developer-body"><section className="case-queue"><div className="queue-header"><div><span className="card-kicker">BANDEJA DE CASOS</span><h2>Casos recientes <em>12</em></h2></div><button className="queue-filter">Todos <span>⌄</span></button></div><div className="queue-search">⌕ <input placeholder="Buscar paciente, cuenta o prestador" /></div><div className="queue-list"><DevCaseRow active={selectedCase === "1482290-1"} onClick={() => setSelectedCase("1482290-1")} initials="AL" patient="Antonia Renata L." account="1482290-1" status="En clasificación" total={7293388} /><DevCaseRow active={selectedCase === "D1305597-1"} onClick={() => setSelectedCase("D1305597-1")} initials="CS" patient="Caso Santiago" account="D1305597-1" status={caseAnalysis ? "Análisis listo" : "Cuenta recibida"} total={23834903} /><DevCaseRow initials="DM" patient="Daysi Muñoz" account="INDISA-2026" status="PAM pendiente" total={4180920} /><DevCaseRow initials="CR" patient="Caso Retamal" account="560488-5" status="Preinforme listo" total={1548200} /></div></section><section className="case-detail"><div className="case-detail-head"><div><span className="case-breadcrumb">EXPEDIENTE / {selected.account}</span><h2>{selected.patient}</h2><p>{selected.provider} · Cuenta {selected.account}</p></div><span className="case-state"><i /> {caseAnalysis ? "Análisis listo" : selected.status}</span></div><div className="dev-summary-metrics"><DevMetric label="Cuenta clínica" value={money(selected.total)} detail="Documento base"/><DevMetric label="PAM / liquidación" value={pamSummary ? "Clasificado" : "Pendiente"} detail={pamSummary ? `${pamSummary.lines} líneas extraídas` : "Sin documento asociado"} pending={!pamSummary}/><DevMetric label="Contrato / plan" value="Pendiente" detail="Requiere incorporación" pending/><DevMetric label="Análisis" value={caseAnalysis ? `${caseAnalysis.lineAssessments.length} líneas` : "Pendiente"} detail={caseAnalysis ? `${caseAnalysis.anomalies.length} anomalías · probabilidades` : "Pulsa Siguiente en vista paciente"} pending={!caseAnalysis}/><DevMetric label="Autorización" value={caseClaimAuthorized ? "Otorgada" : "Pendiente"} detail={caseClaimAuthorized ? "Gestión de reclamos habilitada" : "Requiere autorización del paciente"} pending={!caseClaimAuthorized}/><DevMetric label="Documentos" value={selected.docs} detail="Cuenta · PAM · plan"/></div><div className="dev-tabs">{(["overview", "traceability", "documents"] as const).map((item) => <button key={item} className={devTab === item ? "active" : ""} onClick={() => setDevTab(item)}>{item === "overview" ? "Resumen" : item === "traceability" ? "Matriz de trazabilidad" : "Documentos"}</button>)}</div>{devTab === "overview" && <DeveloperOverview total={selected.total} pamReady={Boolean(pamSummary)} analysis={caseAnalysis} claimAuthorized={caseClaimAuthorized} />}{devTab === "traceability" && <DeveloperTraceability account={selected.account} analysis={caseAnalysis} claimAuthorized={caseClaimAuthorized} />}{devTab === "documents" && <DeveloperDocuments account={selected.account} documentName={documentNames[selected.account]} onReplace={(name) => setDocumentNames((current) => ({ ...current, [selected.account]: name }))} pamSummary={pamSummary}/>}</section></div></section></main>;
}

function DevCaseRow({ active, onClick, initials, patient, account, status, total }: { active?: boolean; onClick?: () => void; initials: string; patient: string; account: string; status: string; total: number }) { return <button onClick={onClick} className={`dev-case-row ${active ? "active" : ""}`}><span className="avatar">{initials}</span><div><b>{patient}</b><small>{account} · {money(total)}</small></div><em className={status.includes("pendiente") ? "amber" : status.includes("listo") ? "green" : "blue"}>{status}</em></button>; }
function DevMetric({ label, value, detail, pending }: { label: string; value: string; detail: string; pending?: boolean }) { return <article className={pending ? "pending" : ""}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function DeveloperOverview({ total, pamReady, analysis, claimAuthorized }: { total: number; pamReady: boolean; analysis?: ClinicalAccountAnalysis; claimAuthorized: boolean }) {
  const analysisReady = Boolean(analysis?.lineAssessments.length);
  const progress = analysisReady ? 72 : pamReady ? 48 : 32;
  return <div className="developer-overview"><div className="dev-flow-card"><div className="card-heading"><div><span className="card-kicker">FLUJO DEL EXPEDIENTE</span><h3>Estado del caso</h3></div><span className="dev-percentage">{progress}%</span></div><div className="dev-flow"><FlowStep number="01" title="Cuenta" state="complete" detail="Recibida"/><i/><FlowStep number="02" title="Clasificación" state={analysisReady ? "complete" : "current"} detail={analysisReady ? "Analizada" : "En curso"}/><i/><FlowStep number="03" title="PAM" state={pamReady ? "complete" : "pending"} detail={pamReady ? "Clasificado" : "Pendiente"}/><i/><FlowStep number="04" title="Preinforme" state="pending" detail="Pendiente"/></div><div className="dev-progress"><i style={{ width: `${progress}%` }} /></div></div><div className="developer-callout"><span>!</span><div><b>{analysisReady && claimAuthorized ? "Autorización registrada" : analysisReady ? "Análisis presuntivo disponible" : pamReady ? "Documentos separados y listos para vincular" : "El caso tiene información pendiente"}</b><p>{analysisReady && claimAuthorized ? "El paciente autorizó a RevisaTuCuenta a preparar y presentar los reclamos pertinentes ante el prestador, dentro del alcance informado." : analysisReady ? "La vista técnica conserva cada línea, probabilidad, página y evidencia faltante para preparar la siguiente revisión. La autorización del paciente aún está pendiente." : pamReady ? "La cuenta clínica y el PAM ya fueron procesados por separado. La siguiente etapa es vincular líneas, arancel y plan." : "La cuenta clínica puede analizarse de forma independiente. Agrega PAM y plan para completar la matriz contractual."}</p><button>Revisar documentos faltantes →</button></div></div><div className="dev-analysis-grid"><article><span className="card-kicker">SALDO DOCUMENTAL</span><strong>{money(total)}</strong><small>Total informado en cuenta clínica</small></article><article><span className="card-kicker">MATRIZ</span><strong>{pamReady ? "1 / 3" : "0 / 3"}</strong><small>Prestación · arancel · plan</small></article><article><span className="card-kicker">PRÓXIMA ACCIÓN</span><strong>{analysisReady ? `${analysis?.lineAssessments.length} líneas` : pamReady ? "Clasificar" : "Cuenta"}</strong><small>{analysisReady ? `${analysis?.anomalies.length ?? 0} anomalías; revisar evidencia` : pamReady ? "Vincular líneas de ambos documentos" : "Ordenar y vincular líneas"}</small></article></div><div className="developer-actions"><button className="portal-button portal-button-primary">Abrir analizador <span>→</span></button><button className="portal-button portal-button-secondary">Exportar preinforme</button></div>{analysisReady && <DeveloperAnalysisDetail analysis={analysis!} claimAuthorized={claimAuthorized} />}</div>;
}
function FlowStep({ number, title, state, detail }: { number: string; title: string; state: "complete" | "current" | "pending"; detail: string }) { return <div className={`flow-step ${state}`}><span>{state === "complete" ? "✓" : number}</span><b>{title}</b><small>{detail}</small></div>; }
function DeveloperTraceability({ account, analysis, claimAuthorized }: { account: string; analysis?: ClinicalAccountAnalysis; claimAuthorized: boolean }) {
  const rows = account === "D1305597-1"
    ? [
        { name: "Día cama pieza exclusiva (MQ)", amount: 770097, anchor: "Día Cama u Hospitalización Transitoria", state: "Pendiente de vínculo" },
        { name: "Día cama U.T.I. pediátrica", amount: 1014471, anchor: "Día Cama de Cuidados Intensivos o Intermedios", state: "Pendiente de vínculo" },
        { name: "Tu. y/o quiste intracraneano c/neuronavegador", amount: 5054240, anchor: "Derecho de Pabellón / Procedimiento", state: "Pendiente de código" },
        { name: "Fármacos y materiales clínicos", amount: 0, anchor: "Medicamentos y Materiales e Insumos Clínicos", state: "Pendiente de desglose" },
      ]
    : [
        { name: "FlapFix", amount: 594204, anchor: "Material implantable neuroquirúrgico", state: "Pendiente de código" },
        { name: "Termómetro digital", amount: 3408, anchor: "Insumo de hospitalización", state: "Pendiente de vínculo" },
        { name: "Derecho de pabellón", amount: 1864729, anchor: "Prestación principal", state: "Identificado" },
        { name: "Honorarios quirúrgicos", amount: 2140800, anchor: "Equipo médico", state: "Identificado" },
      ];
  return <div className="traceability-view"><div className="traceability-toolbar"><div><span className="card-kicker">MATRIZ DE TRAZABILIDAD</span><h3>Línea clínica → prestación → plan</h3></div><button className="portal-button portal-button-secondary">Exportar matriz</button></div><div className="trace-table"><div className="trace-head"><span>Línea de cuenta</span><span>Prestación presumible</span><span>Estado</span><span>Valor</span></div>{rows.map((row) => <div className="trace-row" key={row.name}><div><b>{row.name}</b><small>Cargo individual · cuenta clínica</small></div><span>{row.anchor}</span><em className={row.state === "Identificado" ? "identified" : "review"}>{row.state}</em><strong>{row.amount ? money(row.amount) : "Por desglosar"}</strong></div>)}</div><div className="trace-note"><span>i</span><p>La matriz conserva por separado la cuenta clínica, el arancel y el plan. La relación se confirma cuando el código y el antecedente documental están disponibles.</p></div>{analysis && <DeveloperAnalysisDetail analysis={analysis} claimAuthorized={claimAuthorized}/>}</div>;
}

function DeveloperAnalysisDetail({ analysis, claimAuthorized }: { analysis: ClinicalAccountAnalysis; claimAuthorized?: boolean }) {
  const assessments = analysis.lineAssessments;
  const candidates = assessments.filter((item) => item.candidates.length > 0);
  const candidateAmount = candidates.reduce((sum, item) => sum + item.line.amount, 0);
  const labelForBundle = (bundle: string) => ({
    operating_room: "Derecho de pabellón / perioperatorio",
    hospital_stay: "Día cama / hospitalización",
    procedure: "Procedimiento",
    professional_fees: "Honorarios médicos",
    unassigned: "Sin asignación suficiente",
  } as Record<string, string>)[bundle] || bundle;
  return <section className="developer-analysis-detail"><div className="developer-analysis-detail-head"><div><span className="card-kicker">DETALLE PRESUNTIVO DEL MOTOR</span><h3>Evidencia línea por línea</h3><p>Hipótesis técnicas, no conclusiones jurídicas ni montos recuperables.</p></div><div className="developer-analysis-badges"><span>{assessments.length} líneas</span><span className={claimAuthorized ? "authorized" : "pending"}>{claimAuthorized ? "Autorización otorgada" : "Autorización pendiente"}</span></div></div><div className="developer-detail-metrics"><article><b>{assessments.length}</b><small>Líneas enviadas al motor</small></article><article><b>{candidates.length}</b><small>Con hipótesis de inclusión</small></article><article><b>{money(candidateAmount)}</b><small>Valor de líneas candidatas</small></article><article><b>{analysis.anomalies.length}</b><small>Anomalías técnicas</small></article></div><div className="developer-line-table"><div className="developer-line-head"><span>Línea / origen</span><span>Hipótesis y probabilidad</span><span>Valor</span></div>{assessments.map((assessment) => { const candidate = [...assessment.candidates].sort((left, right) => right.probability - left.probability)[0]; return <article key={assessment.line.id}><div><b>{assessment.line.description}</b><small>{assessment.line.section || "Sección no identificada"} · pág. {assessment.line.page}{assessment.line.code ? ` · código ${assessment.line.code}` : ""}</small></div><div>{candidate ? <><strong>{labelForBundle(candidate.bundle)} · {Math.round(candidate.probability * 100)}%</strong><small>{candidate.reasons[0] || "Coincidencia contextual"}{candidate.missingEvidence.length ? ` · Falta: ${candidate.missingEvidence.join("; ")}` : ""}</small></> : <><strong>Sin hipótesis suficiente</strong><small>Requiere clasificación documental adicional.</small></>}</div><b>{money(assessment.line.amount)}</b></article>; })}</div>{!!analysis.anomalies.length && <div className="developer-anomaly-detail"><div className="developer-analysis-detail-head"><div><b>Anomalías y señales</b><p>Señales que deben contrastarse con contrato, PAM y respuesta del prestador.</p></div></div>{analysis.anomalies.map((anomaly, index) => <article key={`${anomaly.type}-${index}`}><span>{anomaly.severity}</span><div><b>{anomaly.type.replaceAll("_", " ")}</b><p>{anomaly.explanation}</p><small>{anomaly.lineIds.join(" · ")}</small></div></article>)}</div>}<p className="developer-detail-foot">Corpus observado: {analysis.observedCorpus.caseCount} casos · {analysis.observedCorpus.observationCount} observaciones · {analysis.observedCorpus.patternCount} patrones. {analysis.observedCorpus.learningBoundary}</p></section>;
}

function DeveloperDocuments({ account, documentName, onReplace, pamSummary }: { account: string; documentName: string; onReplace: (name: string) => void; pamSummary?: PamSummary }) {
  return <div className="developer-documents"><div className="traceability-toolbar"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h3>Fuentes cargadas</h3></div><span className="document-replacement-note">Cuenta clínica correcta seleccionada</span></div><div className="dev-document-grid"><DevDoc name={documentName} type="Cuenta clínica" state="Extraído" pages="18 páginas" onReplace={onReplace}/><DevDoc name={pamSummary?.name || "PAM / liquidación"} type="PAM" state={pamSummary ? "Clasificado" : "Pendiente"} pages={pamSummary ? `${pamSummary.lines} líneas extraídas` : "Esperando archivo"} pending={!pamSummary}/><DevDoc name="Plan de salud" type="Contrato" state="Pendiente" pages="Esperando archivo" pending/></div></div>;
}
function DevDoc({ name, type, state, pages, pending, onReplace }: { name: string; type: string; state: string; pages: string; pending?: boolean; onReplace?: (name: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && onReplace) onReplace(file.name);
    event.target.value = "";
  }
  return <article className={`dev-doc ${pending ? "pending" : ""}`}><span className="file-mark">{pending ? "+" : "PDF"}</span><div><span>{type}</span><b>{name}</b><small>{pages} · {state}</small></div>{pending ? <button>Cargar</button> : <><button onClick={() => inputRef.current?.click()}>Reemplazar</button><input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={handleChange}/></>}</article>;
}
