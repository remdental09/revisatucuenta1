"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { extractHealthcareDocument } from "../lib/extraction/client";
import type { DocumentExtraction } from "../lib/extraction/types";
import type { ClinicalAccountAnalysis, ChileanBillingLine } from "../lib/rules/chilean-account";

type CaseDocument = {
  id: string;
  caseId: string;
  name: string;
  mimeType: string;
  byteSize: number;
  classification: string;
  confidence: number;
  createdAt: string;
  extraction?: DocumentExtraction;
};
type Activity = { id: string; title: string; detail: string; date: string; pending?: boolean };
type Authorization = { authorized: boolean; scope: string; at?: string };
type Snapshot = {
  case: { id: string; patientName: string; episodeLabel: string; status: string; createdAt: string; updatedAt: string };
  documents: CaseDocument[];
  analysis?: ClinicalAccountAnalysis;
  authorization?: Authorization;
  activities: Activity[];
};
type CaseRow = { id: string; patient_name: string; episode_label: string; status: string; document_count: number };

const money = (value: number) => `$${Math.round(value || 0).toLocaleString("es-CL")}`;

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

async function getSnapshot(caseId: string) {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo cargar el caso");
  return payload as Snapshot;
}

function accountDoc(snapshot?: Snapshot) {
  return snapshot?.documents.filter((doc) => /cuenta|mixto/i.test(doc.classification) || doc.extraction?.account).slice(-1)[0];
}

function pamDoc(snapshot?: Snapshot) {
  return snapshot?.documents.filter((doc) => /pam|liquid/i.test(doc.classification) || doc.extraction?.pam).slice(-1)[0];
}

function totalFrom(doc: CaseDocument | undefined, kind: "account" | "pam") {
  const group = doc?.extraction?.[kind];
  const fieldKey = kind === "account" ? "total" : "billed_total";
  const field = group?.fields.find((item) => item.key === fieldKey);
  const fieldValue = field ? Number(field.value.replace(/[^0-9-]/g, "")) : 0;
  return fieldValue || group?.lines.reduce((sum, line) => sum + line.amount, 0) || 0;
}

function expectedKind(classification: string): "account" | "pam" | "unknown" {
  if (/pam|liquid/i.test(classification)) return "pam";
  if (/cuenta|mixto/i.test(classification)) return "account";
  return "unknown";
}

async function uploadDocument(caseId: string, file: File, classification: string, onProgress?: (value: number) => void) {
  const documentId = crypto.randomUUID();
  const body = new FormData();
  body.append("caseId", caseId);
  body.append("documentId", documentId);
  body.append("classification", classification);
  body.append("confidence", "95");
  body.append("file", file);
  const upload = await fetch("/api/documents", { method: "POST", body });
  if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).error || "No se pudo guardar el documento");
  const extraction = await extractHealthcareDocument(file, expectedKind(classification), onProgress);
  const saved = await fetch("/api/extractions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId, extraction }),
  });
  if (!saved.ok) throw new Error("El documento se guardó, pero la extracción no pudo persistirse");
  return { documentId, extraction };
}

async function analyzeCase(caseId: string, document?: CaseDocument) {
  const lines: ChileanBillingLine[] = document?.extraction?.account?.lines.map((line, index) => ({
    ...line,
    id: `${document.id}-${index}`,
    documentId: document.id,
  })) ?? [];
  if (!lines.length) throw new Error("La cuenta no tiene líneas extraídas para analizar");
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, lines }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "No se pudo analizar la cuenta");
  return response.json() as Promise<ClinicalAccountAnalysis>;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PortalEntry() {
  return (
    <main className="portal-entry">
      <div className="portal-entry-glow" />
      <div className="portal-entry-card">
        <div className="portal-brand"><span>R</span> RevisaTuCuenta</div>
        <p className="portal-kicker">Portal operativo de casos clínicos</p>
        <h1>Una cuenta clara empieza por un expediente ordenado.</h1>
        <p className="portal-entry-copy">Paciente y equipo de revisión trabajan sobre el mismo caso persistido, con documentos separados y trazabilidad por página.</p>
        <div className="portal-entry-actions">
          <a className="portal-button portal-button-primary" href="/?view=patient">Revisar mi cuenta</a>
          <a className="portal-button portal-button-secondary" href="/?view=developer">Abrir consola de desarrollo ↗</a>
        </div>
        <div className="portal-entry-foot"><span>●</span> Estado sincronizado con el expediente</div>
      </div>
    </main>
  );
}

function PatientStart({ onCreated }: { onCreated: (caseId: string) => void }) {
  const [name, setName] = useState("");
  const [episode, setEpisode] = useState("Revisión de cuenta clínica");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const created = await fetch("/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, patientName: name || "Paciente", episodeLabel: episode }) });
      if (!created.ok) throw new Error("No se pudo crear el expediente");
      if (file) await uploadDocument(id, file, "Cuenta clínica");
      onCreated(id);
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo crear el expediente"));
    } finally {
      setBusy(false);
    }
  }

  return <main className="patient-login"><form className="patient-login-card" onSubmit={submit}><div className="portal-brand"><span>R</span> RevisaTuCuenta</div><div className="login-seal">⌁</div><p className="portal-kicker">Nuevo expediente</p><h1>Comienza tu revisión.</h1><p>Ingresa tus datos y, si ya la tienes, carga la cuenta clínica del prestador.</p><input aria-label="Nombre" placeholder="Nombre para identificar el caso" value={name} onChange={(event) => setName(event.target.value)} /><input aria-label="Episodio" placeholder="Episodio o atención" value={episode} onChange={(event) => setEpisode(event.target.value)} /><label className="portal-button portal-button-secondary"><input type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(event) => setFile(event.target.files?.[0])} />{file ? file.name : "Cargar cuenta clínica"}</label>{error && <p className="patient-analysis-notice">{error}</p>}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "Creando expediente…" : "Crear expediente"}</button><a className="back-link" href="/">← Volver</a></form></main>;
}

export function PatientPortal() {
  const [caseId, setCaseId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("case") || "");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<"Resumen" | "Documentos" | "Actividad">("Resumen");
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Esperando documentos");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!caseId) return;
    try { setError(""); const next = await getSnapshot(caseId); setSnapshot(next); if (next.analysis) setStatus("complete"); }
    catch (reason) { setError(errorMessage(reason, "No se pudo cargar el expediente")); }
  }
  useEffect(() => { void refresh(); }, [caseId]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3000); }

  async function handlePam(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !caseId) return;
    setBusy(true); setProgress(0); setStage("Guardando PAM / liquidación");
    try { await uploadDocument(caseId, file, "PAM / liquidación", (value) => setProgress(value)); await refresh(); notify("PAM cargado y vinculado al expediente"); }
    catch (reason) { notify(errorMessage(reason, "No se pudo cargar el PAM")); }
    finally { setBusy(false); }
  }

  async function runAnalysis() {
    if (!snapshot || !caseId) return;
    setBusy(true); setStatus("running"); setProgress(20); setStage("Clasificando líneas de la cuenta");
    try { await analyzeCase(caseId, accountDoc(snapshot)); setProgress(100); setStage("Resultado disponible para revisión"); setStatus("complete"); await refresh(); notify("Análisis guardado en el expediente"); }
    catch (reason) { setStatus("error"); setError(errorMessage(reason, "No se pudo analizar la cuenta")); }
    finally { setBusy(false); }
  }

  async function authorize() {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/authorization`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    if (!response.ok) { notify("No se pudo registrar la autorización"); return; }
    await refresh(); notify("Autorización registrada");
  }

  if (!caseId) return <PatientStart onCreated={setCaseId} />;
  if (error && !snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>No se pudo abrir el expediente</h2><p>{error}</p><button className="portal-button portal-button-primary" onClick={() => void refresh()}>Reintentar</button></section></main>;
  if (!snapshot) return <main className="patient-portal"><section className="patient-card patient-main"><h2>Cargando expediente…</h2></section></main>;

  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const accountTotal = totalFrom(account, "account"); const pamTotal = totalFrom(pam, "pam");
  const firstName = snapshot.case.patientName.split(" ")[0];
  return <main className="patient-portal">
    <header className="patient-topbar"><a className="portal-brand" href="/"><span>R</span> RevisaTuCuenta</a><div className="patient-topbar-right"><span className="surface-pill patient-pill">Vista paciente</span><span className="avatar">{snapshot.case.patientName.slice(0, 2).toUpperCase()}</span><span className="patient-email">{snapshot.case.patientName}</span><a href={`/?view=developer&case=${encodeURIComponent(caseId)}`} target="_blank" rel="noreferrer" className="developer-link">Vista desarrollador ↗</a></div></header>
    <div className="patient-layout"><aside className="patient-sidebar"><div className="case-mini"><span className="case-icon">⌁</span><div><small>CASO ACTIVO</small><b>{snapshot.case.patientName}</b><span>Expediente {caseId.slice(0, 8)}</span></div></div><nav className="patient-nav">{(["Resumen", "Documentos", "Actividad"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav><div className="patient-sidebar-help"><span>?</span><div><b>¿Necesitas ayuda?</b><small>Escríbenos sobre tu caso.</small></div></div></aside>
      <section className="patient-main"><div className="patient-heading"><div><p className="portal-kicker">Mi expediente</p><h1>Hola, {firstName}.</h1><p>{snapshot.case.episodeLabel}</p></div><span className="case-status"><i /> {snapshot.case.status === "analysis_ready" ? "Análisis listo" : "En revisión"}</span></div>
        {tab === "Resumen" && <PatientSummary snapshot={snapshot} account={account} pam={pam} accountTotal={accountTotal} pamTotal={pamTotal} status={status} progress={progress} stage={stage} busy={busy} onPam={() => inputRef.current?.click()} onAnalyze={() => void runAnalysis()} onAuthorize={() => void authorize()} />}
        {tab === "Documentos" && <PatientDocuments snapshot={snapshot} onPam={() => inputRef.current?.click()} />}
        {tab === "Actividad" && <PatientActivity activities={snapshot.activities} />}
      </section></div>
    <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={handlePam} />{toast && <div className="portal-toast"><span>✓</span>{toast}</div>}
  </main>;
}

function PatientSummary({ snapshot, account, pam, accountTotal, pamTotal, status, progress, stage, busy, onPam, onAnalyze, onAuthorize }: { snapshot: Snapshot; account?: CaseDocument; pam?: CaseDocument; accountTotal: number; pamTotal: number; status: "idle" | "running" | "complete" | "error"; progress: number; stage: string; busy: boolean; onPam: () => void; onAnalyze: () => void; onAuthorize: () => void }) {
  const analysis = snapshot.analysis; const difference = Math.abs(pamTotal - accountTotal); const candidate = analysis?.lineAssessments.filter((assessment) => assessment.candidates.some((item) => item.probability >= 0.45)).reduce((sum, assessment) => sum + assessment.line.amount, 0) || 0;
  return <><div className="patient-metrics"><article className="patient-metric-card accent"><div className="metric-top"><span>CUENTA CLÍNICA</span><b>✓</b></div><strong>{money(accountTotal)}</strong><small>{account?.name || "Pendiente"}</small><em>{account ? "Documento disponible" : "Falta cargar"}</em></article><article className="patient-metric-card"><div className="metric-top"><span>PAM / LIQUIDACIÓN</span><b>02</b></div><strong className={pam ? "" : "pending-value"}>{pam ? "Recibido" : "Pendiente"}</strong><small>{pam?.name || "Agrega la liquidación para completar el contraste"}</small><button onClick={onPam} className="inline-action">{pam ? "Reemplazar PAM" : "Agregar PAM"} →</button></article><article className="patient-metric-card"><div className="metric-top"><span>CONTRATO / PLAN</span><b>03</b></div><strong className="pending-value">Pendiente</strong><small>Se incorporará para vincular cada cargo con su cobertura.</small></article></div>
    <section className="patient-card document-processing-card"><div className="card-heading"><div><span className="card-kicker">ANÁLISIS SEPARADO</span><h2>Cuenta clínica y PAM</h2></div><span className="progress-label">No se mezclan los documentos</span></div><div className="analysis-sources"><article className="analysis-source"><div className="analysis-source-head"><div><b>Cuenta clínica</b><small>{account?.name || "Aún no cargada"}</small></div><em className={account ? "analysis-done" : "analysis-pending"}>{account ? "Recibida" : "Pendiente"}</em></div><div className="analysis-bar"><i style={{ width: account ? "100%" : "0%" }} /></div></article><article className="analysis-source"><div className="analysis-source-head"><div><b>PAM / liquidación</b><small>{pam?.name || "Aún no cargado"}</small></div><em className={pam ? "analysis-done" : "analysis-pending"}>{pam ? "Recibido" : "Pendiente"}</em></div><div className="analysis-bar"><i style={{ width: pam ? "100%" : "0%" }} /></div></article></div></section>
    {status !== "idle" && <section className="patient-card patient-analysis-card"><div className="card-heading"><div><span className="card-kicker">RESULTADO DEL MOTOR</span><h2>Resultado operativo del expediente</h2></div><span className={`patient-analysis-status ${status}`}>{status === "running" ? `${progress}%` : status === "complete" ? "Listo" : "Revisar"}</span></div>{status === "running" && <><div className="patient-analysis-progress-meta"><span>{stage}</span><b>{progress}%</b></div><div className="patient-analysis-progress"><i style={{ width: `${progress}%` }} /></div></>}{status === "complete" && <><div className="patient-analysis-metrics patient-limited-metrics"><article><span>TOTAL DE LA CUENTA</span><strong>{money(accountTotal)}</strong><small>Fuente del prestador</small></article><article><span>DIFERENCIA DOCUMENTAL</span><strong>{money(difference)}</strong><small>Cuenta versus PAM</small></article><article><span>LÍNEAS PARA CONTRASTAR</span><strong>{money(candidate)}</strong><small>Hipótesis preliminar</small></article></div><section className="patient-recovery-card"><div><span className="card-kicker">SIGUIENTE DECISIÓN</span><h3>Revisar y preparar aclaraciones</h3><p>El monto es una hipótesis de revisión, no una devolución garantizada.</p></div>{snapshot.authorization?.authorized ? <div className="patient-authorization-confirmed"><b>Autorización registrada</b><small>La gestión puede preparar solicitudes dentro del alcance autorizado.</small></div> : <button className="portal-button portal-button-primary" onClick={onAuthorize}>Autorizar gestión de reclamos →</button>}</section></>}</section>}
    <section className="patient-card next-card"><span className="card-kicker">SIGUIENTE PASO</span><h2>{analysis ? "Análisis disponible" : pam ? "Ejecutar análisis" : "Completar expediente"}</h2><p>{analysis ? "El resultado guardado ya puede ser revisado por el equipo técnico." : "Los documentos se conservan por separado y el análisis se guarda en el caso."}</p><button className="portal-button portal-button-primary" onClick={pam ? onAnalyze : onPam} disabled={busy}>{busy ? "Procesando…" : pam ? "Analizar expediente" : "Agregar PAM"} →</button></section></>;
}

function PatientDocuments({ snapshot, onPam }: { snapshot: Snapshot; onPam: () => void }) { return <section className="patient-card documents-view"><div className="card-heading"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h2>Fuentes cargadas</h2></div><button className="portal-button portal-button-primary" onClick={onPam}>Agregar PAM +</button></div><div className="document-list">{snapshot.documents.map((doc) => <article className="patient-document clinic" key={doc.id}><span className="file-mark">PDF</span><div><span>{doc.classification}</span><b>{doc.name}</b><small>{doc.extraction?.pageCount || "-"} páginas · {doc.extraction ? "Extraído" : "Pendiente"}</small></div><div className="document-status"><em>Disponible</em></div></article>)}</div><div className="document-tip"><span>i</span><p>La cuenta muestra los cargos del prestador y el PAM la liquidación de cobertura. Cada documento mantiene su origen.</p></div></section>; }
function PatientActivity({ activities }: { activities: Activity[] }) { return <section className="patient-card activity-view"><span className="card-kicker">ACTIVIDAD</span><h2>Movimientos del expediente</h2><div className="activity-list">{activities.length ? activities.map((activity) => <div className={`activity-item ${activity.pending ? "pending" : ""}`} key={activity.id}><span className="activity-dot" /><div><small>{new Date(activity.date).toLocaleString("es-CL")}</small><b>{activity.title}</b><p>{activity.detail}</p></div></div>) : <p>Aún no hay movimientos.</p>}</div></section>; }

function useCases() {
  const [cases, setCases] = useState<CaseRow[]>([]); const [error, setError] = useState("");
  const refresh = async () => { try { const response = await fetch("/api/cases", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setCases(payload.cases || []); } catch (reason) { setError(errorMessage(reason, "No se pudieron cargar los casos")); } };
  useEffect(() => { void refresh(); }, []); return { cases, error, refresh };
}

export function DeveloperPortal() {
  const { cases, error: casesError, refresh: refreshCases } = useCases();
  const [selectedId, setSelectedId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("case") || "");
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [tab, setTab] = useState<"overview" | "traceability" | "documents">("overview"); const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const selected = selectedId || cases[0]?.id || "";
  useEffect(() => { if (!selectedId && cases[0]?.id) setSelectedId(cases[0].id); }, [cases, selectedId]);
  async function refresh() { if (!selected) return; try { setSnapshot(await getSnapshot(selected)); } catch (reason) { setNotice(errorMessage(reason, "No se pudo cargar el expediente")); } }
  useEffect(() => { void refresh(); }, [selected]);
  async function onFile(file: File, classification: string) { if (!selected) return; setBusy(true); try { await uploadDocument(selected, file, classification); await refresh(); await refreshCases(); setNotice("Documento guardado y extraído"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo procesar el documento")); } finally { setBusy(false); } }
  async function onAnalyze() { if (!snapshot) return; setBusy(true); try { await analyzeCase(selected, accountDoc(snapshot)); await refresh(); await refreshCases(); setTab("traceability"); setNotice("Análisis guardado"); } catch (reason) { setNotice(errorMessage(reason, "No se pudo analizar el caso")); } finally { setBusy(false); } }
  const visibleCases = useMemo(() => cases.filter((item) => `${item.patient_name} ${item.id} ${item.episode_label}`.toLowerCase().includes(query.toLowerCase())), [cases, query]);
  if (!selected) return <main className="developer-portal"><section className="developer-main"><header className="developer-header"><div><p className="portal-kicker">CONSOLA DE DESARROLLO</p><h1>Expedientes</h1><p>{casesError || "Todavía no hay expedientes operativos."}</p></div><a className="portal-button portal-button-primary" href="/?view=patient">Crear desde vista paciente</a></header></section></main>;
  const account = accountDoc(snapshot); const pam = pamDoc(snapshot); const total = totalFrom(account, "account");
  return <main className="developer-portal"><aside className="developer-sidebar"><a className="portal-brand dev-brand" href="/"><span>R</span> RevisaTuCuenta</a><div className="dev-workspace-label">ESPACIO DE TRABAJO</div><nav className="dev-nav"><a className="active" href="/?view=developer"><span>▦</span> Expedientes <em>{cases.length}</em></a><a href="#rules"><span>◌</span> Reglas del motor</a><a href="#corpus"><span>⌁</span> Corpus observado</a></nav><div className="dev-sidebar-bottom"><a href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer"><span>↗</span> Vista paciente</a><div className="dev-user"><span className="avatar">DEV</span><div><b>Desarrollador</b><small>Expedientes operativos</small></div></div></div></aside><section className="developer-main"><header className="developer-header"><div><p className="portal-kicker">CONSOLA DE DESARROLLO</p><h1>Expedientes</h1><p>Revisión técnica sobre los documentos persistidos del caso seleccionado.</p></div><div className="developer-header-actions"><span className="surface-pill developer-pill">Vista desarrollador</span><a className="portal-button portal-button-secondary" href={`/?view=patient&case=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer">Abrir vista paciente ↗</a></div></header><div className="developer-body"><section className="case-queue"><div className="queue-header"><div><span className="card-kicker">BANDEJA DE CASOS</span><h2>Casos recientes <em>{cases.length}</em></h2></div></div><div className="queue-search">⌕ <input placeholder="Buscar paciente, cuenta o episodio" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="queue-list">{visibleCases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`dev-case-row ${selected === item.id ? "active" : ""}`}><span className="avatar">{item.patient_name.slice(0, 2).toUpperCase()}</span><div><b>{item.patient_name}</b><small>{item.id} · {item.document_count} documentos</small></div><em className={item.status.includes("analysis") ? "green" : "blue"}>{item.status}</em></button>)}</div></section><section className="case-detail"><div className="case-detail-head"><div><span className="case-breadcrumb">EXPEDIENTE / {selected}</span><h2>{snapshot?.case.patientName || "Cargando…"}</h2><p>{snapshot?.case.episodeLabel || ""}</p></div><span className="case-state"><i /> {snapshot?.case.status || "Cargando"}</span></div>{snapshot && <><div className="dev-summary-metrics"><DevMetric label="Cuenta clínica" value={money(total)} detail="Documento base"/><DevMetric label="Desfragmentación" value={snapshot.analysis ? `${snapshot.analysis.lineAssessments.length} líneas` : "Pendiente"} detail="Hipótesis técnicas" pending={!snapshot.analysis}/><DevMetric label="Contexto PAM" value={pam ? "Recibido" : "Pendiente"} detail="Se conserva separado" pending={!pam}/><DevMetric label="Autorización" value={snapshot.authorization?.authorized ? "Otorgada" : "Pendiente"} detail="Gestión de reclamos" pending={!snapshot.authorization?.authorized}/><DevMetric label="Documentos" value={String(snapshot.documents.length)} detail="Fuentes del caso"/></div><div className="dev-tabs">{(["overview", "traceability", "documents"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "overview" ? "Resumen" : item === "traceability" ? "Matriz de trazabilidad" : "Documentos"}</button>)}</div>{notice && <p className="patient-analysis-notice">{notice}</p>}{tab === "overview" && <DeveloperOverview snapshot={snapshot} total={total} busy={busy} onAnalyze={() => void onAnalyze()} onExport={() => downloadJson(`${selected}-preinforme.json`, snapshot)} />}{tab === "traceability" && <DeveloperTraceability snapshot={snapshot} onExport={() => downloadJson(`${selected}-matriz.json`, snapshot.analysis)} />}{tab === "documents" && <DeveloperDocuments snapshot={snapshot} busy={busy} onFile={(file, kind) => void onFile(file, kind)} />}</>}</section></div></section></main>;
}

function DevMetric({ label, value, detail, pending }: { label: string; value: string; detail: string; pending?: boolean }) { return <article className={`dev-metric ${pending ? "pending" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function DeveloperOverview({ snapshot, total, busy, onAnalyze, onExport }: { snapshot: Snapshot; total: number; busy: boolean; onAnalyze: () => void; onExport: () => void }) { const account = accountDoc(snapshot); const analysis = snapshot.analysis; const candidates = analysis?.lineAssessments.filter((item) => item.candidates.some((candidate) => candidate.probability >= 0.45)) || []; return <div className="developer-overview"><div className="dev-flow-card"><div className="card-heading"><div><span className="card-kicker">FLUJO DEL EXPEDIENTE</span><h3>Cuenta clínica primero</h3></div><span className="dev-percentage">{analysis ? "100%" : "50%"}</span></div><div className="dev-flow"><FlowStep number="01" title="Cuenta" state={account ? "complete" : "pending"} detail={account ? "Recibida" : "Pendiente"}/><i/><FlowStep number="02" title="Análisis" state={analysis ? "complete" : "current"} detail={analysis ? "Listo" : "En curso"}/><i/><FlowStep number="03" title="Contexto PAM" state={pamDoc(snapshot) ? "complete" : "pending"} detail={pamDoc(snapshot) ? "Separado" : "Opcional"}/><i/><FlowStep number="04" title="Preinforme" state={analysis ? "current" : "pending"} detail={analysis ? "Disponible" : "Pendiente"}/></div></div><div className="developer-scope-card"><div><span className="card-kicker">ALCANCE ACTUAL</span><h3>Posibles desfragmentaciones del prestador</h3><p>Se revisan glosas, códigos, cantidades y vínculos dentro de la cuenta clínica. El PAM se conserva como contexto documental.</p></div><span>OPERATIVO</span></div><div className="dev-analysis-grid"><article><span className="card-kicker">CUENTA CLÍNICA</span><strong>{money(total)}</strong><small>Total informado por el prestador</small></article><article><span className="card-kicker">LÍNEAS CANDIDATAS</span><strong>{candidates.length}</strong><small>Requieren contraste técnico</small></article><article><span className="card-kicker">PRÓXIMA ACCIÓN</span><strong>{analysis ? "Exportar" : "Analizar"}</strong><small>{analysis ? "Preinforme del caso" : "Ejecutar motor"}</small></article></div><div className="developer-actions"><button className="portal-button portal-button-primary" onClick={onAnalyze} disabled={busy}>{busy ? "Procesando…" : analysis ? "Actualizar análisis" : "Abrir analizador"} →</button><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar preinforme</button></div>{analysis && <DeveloperAnalysisDetail analysis={analysis}/>}</div>; }
function DeveloperTraceability({ snapshot, onExport }: { snapshot: Snapshot; onExport: () => void }) { return <div className="traceability-view"><div className="traceability-toolbar"><div><span className="card-kicker">MATRIZ DE CUENTA CLÍNICA</span><h3>Evidencia línea por línea</h3></div><button className="portal-button portal-button-secondary" onClick={onExport}>Exportar matriz</button></div>{snapshot.analysis ? <DeveloperAnalysisDetail analysis={snapshot.analysis}/> : <section className="trace-note"><span>i</span><p>Ejecuta el análisis desde Resumen para generar la matriz.</p></section>}</div>; }
function DeveloperAnalysisDetail({ analysis }: { analysis: ClinicalAccountAnalysis }) { const rows = analysis.lineAssessments.filter((item) => !/bonificacion|copago|liquidacion|pam|ajuste/i.test(`${item.line.description} ${item.line.section || ""}`)); return <section className="developer-analysis-detail"><div className="developer-analysis-detail-head"><div><span className="card-kicker">ANÁLISIS DEL PRESTADOR</span><h3>Hipótesis técnicas trazables</h3><p>Estos resultados requieren contraste contractual y documental.</p></div><div className="developer-analysis-badges"><span>{rows.length} líneas en foco</span></div></div><div className="developer-detail-metrics"><article><b>{rows.length}</b><small>Líneas en foco</small></article><article><b>{rows.filter((item) => item.candidates.length).length}</b><small>Con hipótesis</small></article><article><b>{money(rows.filter((item) => item.candidates.length).reduce((sum, item) => sum + item.line.amount, 0))}</b><small>Valor bajo hipótesis</small></article><article><b>{analysis.anomalies.length}</b><small>Señales</small></article></div><div className="developer-line-table"><div className="developer-line-head"><span>Línea / origen</span><span>Hipótesis</span><span>Valor</span></div>{rows.map((item) => { const candidate = [...item.candidates].sort((left, right) => right.probability - left.probability)[0]; return <article key={item.line.id}><div><b>{item.line.description}</b><small>{item.line.section || "Sin sección"} · pág. {item.line.page}{item.line.code ? ` · código ${item.line.code}` : ""}</small></div><div><strong>{candidate ? `${Math.round(candidate.probability * 100)}%` : "Sin hipótesis"}</strong><small>{candidate?.reasons[0] || "Requiere clasificación adicional"}{candidate?.missingEvidence?.length ? ` · Falta: ${candidate.missingEvidence.join("; ")}` : ""}</small></div><b>{money(item.line.amount)}</b></article>; })}</div></section>; }
function FlowStep({ number, title, state, detail }: { number: string; title: string; state: "complete" | "current" | "pending"; detail: string }) { return <div className={state}><span>{number}</span><b>{title}</b><small>{detail}</small></div>; }
function DeveloperDocuments({ snapshot, busy, onFile }: { snapshot: Snapshot; busy: boolean; onFile: (file: File, classification: string) => void }) { return <div className="developer-documents"><div className="traceability-toolbar"><div><span className="card-kicker">DOCUMENTOS DEL CASO</span><h3>Fuentes cargadas</h3></div><span className="document-replacement-note">Los archivos nuevos quedan vinculados al caso</span></div><div className="dev-document-grid"><OperationalDoc type="Cuenta clínica" document={accountDoc(snapshot)} classification="Cuenta clínica" busy={busy} onFile={onFile}/><OperationalDoc type="PAM / liquidación" document={pamDoc(snapshot)} classification="PAM / liquidación" busy={busy} onFile={onFile}/><OperationalDoc type="Contrato / plan" document={snapshot.documents.find((doc) => /contrato|plan/i.test(doc.classification))} classification="Contrato" busy={busy} onFile={onFile}/></div></div>; }
function OperationalDoc({ type, document, classification, busy, onFile }: { type: string; document?: CaseDocument; classification: string; busy: boolean; onFile: (file: File, classification: string) => void }) { const input = useRef<HTMLInputElement>(null); return <article className={`dev-doc ${document ? "" : "pending"}`}><span className="file-mark">{document ? "PDF" : "+"}</span><div><span>{type}</span><b>{document?.name || "Esperando archivo"}</b><small>{document ? `${document.extraction?.pageCount || "-"} páginas · extraído` : "Pendiente"}</small></div><button onClick={() => input.current?.click()} disabled={busy}>{document ? "Reemplazar" : "Cargar"}</button><input ref={input} hidden type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file, classification); }} /></article>; }
