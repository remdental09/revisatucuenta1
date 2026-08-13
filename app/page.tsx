"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DocKind = "Cuenta clínica" | "PAM / liquidación" | "Contrato" | "Documento mixto" | "Por confirmar";
type UploadedDoc = {
  id: string;
  name: string;
  size: string;
  kind: DocKind;
  confidence: number;
  segments?: { kind: string; pages: string; confidence: number }[];
};

const steps = ["Crear caso", "Documentos", "Clasificación", "Validación", "Procesamiento", "Resultado", "Dashboard"];

const demoDocument: UploadedDoc = {
  id: "doc-demo-indisa",
  name: "CUENTA INDISA_APENDICITIS.pdf",
  size: "22 páginas · PDF escaneado",
  kind: "Documento mixto",
  confidence: 94,
  segments: [
    { kind: "Cuenta clínica INDISA", pages: "Páginas 1–8", confidence: 96 },
    { kind: "PAM / liquidaciones Nueva Masvida", pages: "Páginas 9–22", confidence: 93 },
  ],
};

function classifyFile(file: File): UploadedDoc {
  const n = file.name.toLowerCase();
  let kind: DocKind = "Por confirmar";
  let confidence = 68;
  if ((n.includes("cuenta") && n.includes("pam")) || n.includes("indisa_apendicitis")) {
    kind = "Documento mixto";
    confidence = 92;
  } else if (n.includes("pam") || n.includes("liquidacion") || n.includes("bonificacion")) {
    kind = "PAM / liquidación";
    confidence = 91;
  } else if (n.includes("contrato") || n.includes("plan") || n.includes("cobertura")) {
    kind = "Contrato";
    confidence = 89;
  } else if (n.includes("cuenta") || n.includes("clinica")) {
    kind = "Cuenta clínica";
    confidence = 86;
  }
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    kind,
    confidence,
  };
}

export default function Home() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [caseId, setCaseId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [episode, setEpisode] = useState("Hospitalización por apendicitis");
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [processing, setProcessing] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const availability = useMemo(() => ({
    cuenta: docs.some((d) => d.kind === "Cuenta clínica" || d.kind === "Documento mixto"),
    pam: docs.some((d) => d.kind === "PAM / liquidación" || d.kind === "Documento mixto"),
    contrato: docs.some((d) => d.kind === "Contrato"),
  }), [docs]);

  useEffect(() => {
    if (step !== 4) return;
    setProcessing(0);
    const timers = [22, 45, 68, 88, 100].map((value, index) =>
      window.setTimeout(() => setProcessing(value), 480 * (index + 1))
    );
    const done = window.setTimeout(() => setStep(5), 3000);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [step]);

  async function createCase() {
    const id = crypto.randomUUID();
    setCaseId(id);
    try {
      await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, patientName: patientName || "Paciente", episodeLabel: episode }),
      });
    } catch { /* La interfaz conserva el avance si la red local aún inicia. */ }
    setStep(1);
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).map(classifyFile);
    setDocs((current) => [...current, ...next]);
    if (caseId) {
      for (let i = 0; i < files.length; i += 1) {
        const body = new FormData();
        body.append("caseId", caseId);
        body.append("documentId", next[i].id);
        body.append("classification", next[i].kind);
        body.append("confidence", String(next[i].confidence));
        body.append("file", files[i]);
        fetch("/api/documents", { method: "POST", body }).catch(() => undefined);
      }
    }
  }

  function loadDemo() {
    setPatientName("Paciente de prueba");
    setEpisode("Hospitalización por apendicitis · Clínica INDISA");
    setCaseId("RTC-DEMO-2408");
    setDocs([demoDocument]);
    setStarted(true);
    setStep(2);
  }

  if (!started) {
    return (
      <main className="landing">
        <nav className="nav shell">
          <a className="brand" href="#top" aria-label="RevisaTuCuenta inicio"><span className="brandMark">R</span>RevisaTuCuenta</a>
          <div className="navLinks"><a href="#como-funciona">Cómo funciona</a><a href="#seguridad">Seguridad</a></div>
          <button className="button ghost" onClick={() => { setStarted(true); setStep(0); }}>Ingresar</button>
        </nav>

        <section className="hero shell" id="top">
          <div className="eyebrow"><span>●</span> Tu cuenta merece una segunda mirada</div>
          <h1>Entiende lo que te cobraron.<br/><em>Reclama con fundamento.</em></h1>
          <p className="heroCopy">Reunimos tu cuenta clínica, PAM y contrato para reconstruir el cobro y mostrarte, con evidencia, qué conviene revisar.</p>
          <div className="heroActions">
            <button className="button primary large" onClick={() => { setStarted(true); setStep(0); }}>Revisar mi cuenta <span>→</span></button>
            <button className="button textButton" onClick={loadDemo}>Ver caso de ejemplo</button>
          </div>
          <p className="microcopy">Análisis preliminar · Sin afirmar cobros indebidos · Tú decides cómo continuar</p>
          <div className="documentScene" aria-label="Documentos conectados para formar un caso">
            <article className="paper paperOne"><small>CLÍNICA</small><h3>Cuenta clínica</h3><div className="paperLines"/><strong>$4.280.450</strong></article>
            <article className="paper paperTwo"><small>ISAPRE</small><h3>PAM / liquidación</h3><div className="paperLines"/><strong>Bonificación</strong></article>
            <article className="paper paperThree"><small>TU PLAN</small><h3>Contrato</h3><div className="paperLines"/><strong>Coberturas</strong></article>
            <div className="caseBadge"><span>✓</span><div><small>EXPEDIENTE ORDENADO</small><b>Caso listo para revisar</b></div></div>
          </div>
        </section>

        <section className="trustStrip"><div className="shell trustGrid"><div><b>01</b><span>Sube tus documentos</span></div><div><b>02</b><span>Los ordenamos y conectamos</span></div><div><b>03</b><span>Recibe un mapa claro de revisión</span></div></div></section>

        <section className="how shell" id="como-funciona">
          <div><p className="sectionKicker">Un expediente, no una caja negra</p><h2>Cada dato vuelve a su origen.</h2></div>
          <p>Todo monto, código o conclusión conserva el documento y la página de donde fue extraído. Puedes revisar la evidencia antes de avanzar a un reclamo.</p>
        </section>
        <section className="privacy shell" id="seguridad"><span className="privacyIcon">◇</span><div><b>Tus documentos son privados</b><p>Se almacenan para tu caso y nunca se publican. Esta versión no reemplaza asesoría médica ni jurídica.</p></div></section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <button className="brand brandButton" onClick={() => setStarted(false)}><span className="brandMark">R</span>RevisaTuCuenta</button>
        <div className="caseRef">{caseId ? `Caso ${caseId.slice(0, 8).toUpperCase()}` : "Nuevo caso"}</div>
        <button className="helpButton">? <span>Ayuda</span></button>
      </header>
      <div className="workspace">
        <aside className="stepper" aria-label="Progreso del caso">
          <p>Tu revisión</p>
          {steps.map((label, i) => (
            <button key={label} className={`${i === step ? "active" : ""} ${i < step ? "done" : ""}`} disabled={i > step} onClick={() => i < step && setStep(i)}>
              <span>{i < step ? "✓" : i + 1}</span>{label}
            </button>
          ))}
          <div className="asideNote"><b>Tu avance se guarda</b><span>Puedes volver y continuar después.</span></div>
        </aside>

        <section className="stage">
          {step === 0 && <CreateCase patientName={patientName} setPatientName={setPatientName} episode={episode} setEpisode={setEpisode} onContinue={createCase}/>} 
          {step === 1 && <UploadStep docs={docs} inputRef={inputRef} addFiles={addFiles} loadDemo={loadDemo} onContinue={() => setStep(2)}/>} 
          {step === 2 && <ClassificationStep docs={docs} setDocs={setDocs} onBack={() => setStep(1)} onContinue={() => setStep(3)}/>} 
          {step === 3 && <ValidationStep availability={availability} onBack={() => setStep(2)} onContinue={() => setStep(4)}/>} 
          {step === 4 && <ProcessingStep progress={processing}/>} 
          {step === 5 && <ResultStep hasContract={availability.contrato} onContinue={() => setStep(6)}/>} 
          {step === 6 && <Dashboard docs={docs} caseId={caseId}/>} 
        </section>
      </div>
    </main>
  );
}

function StageTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="stageTitle"><p>{eyebrow}</p><h1>{title}</h1><span>{copy}</span></header>;
}

function CreateCase({ patientName, setPatientName, episode, setEpisode, onContinue }: { patientName: string; setPatientName: (v: string) => void; episode: string; setEpisode: (v: string) => void; onContinue: () => void }) {
  return <div className="stageInner narrow"><StageTitle eyebrow="PASO 1 DE 7" title="Cuéntanos sobre este caso" copy="Usaremos estos datos para ordenar tus documentos. No necesitas conocer términos técnicos."/><div className="formCard"><label>Nombre para identificar al paciente<input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Ej: María P."/></label><label>¿Qué atención quieres revisar?<input value={episode} onChange={(e) => setEpisode(e.target.value)} placeholder="Ej: Hospitalización de julio"/></label><label>Prestador de salud (opcional)<input placeholder="Ej: Clínica INDISA"/></label><div className="infoLine"><span>i</span> Puedes usar iniciales si prefieres. El nombre no afecta el análisis.</div></div><div className="stageActions end"><button className="button primary" onClick={onContinue}>Crear caso y continuar →</button></div></div>;
}

function UploadStep({ docs, inputRef, addFiles, loadDemo, onContinue }: { docs: UploadedDoc[]; inputRef: React.RefObject<HTMLInputElement | null>; addFiles: (f: FileList | null) => void; loadDemo: () => void; onContinue: () => void }) {
  return <div className="stageInner"><StageTitle eyebrow="PASO 2 DE 7" title="Reúne tus documentos" copy="Puedes subirlos juntos en un solo PDF o por separado. Nosotros identificaremos qué contiene cada archivo."/><div className="uploadGrid"><button className="dropZone" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}><span className="uploadIcon">↑</span><b>Arrastra tus archivos aquí</b><small>o haz clic para buscarlos</small><em>PDF, JPG o PNG · hasta 25 MB por archivo</em></button><input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={(e) => addFiles(e.target.files)}/><div className="neededDocs"><h3>Idealmente incluye</h3>{["Cuenta clínica detallada","PAM o liquidación de la Isapre","Contrato o plan de salud"].map((x,i)=><div key={x}><span>{i+1}</span><p><b>{x}</b><small>{i===2 ? "Puedes agregarlo después" : "Necesario para cruzar los cobros"}</small></p></div>)}<button className="demoLink" onClick={loadDemo}>Usar caso emblemático INDISA →</button></div></div>{docs.length > 0 && <div className="uploadedSummary"><b>{docs.length} archivo{docs.length > 1 ? "s" : ""} listo{docs.length > 1 ? "s" : ""}</b>{docs.map(d=><span key={d.id}>✓ {d.name}</span>)}</div>}<div className="stageActions end"><button className="button primary" disabled={!docs.length} onClick={onContinue}>Clasificar documentos →</button></div></div>;
}

function ClassificationStep({ docs, setDocs, onBack, onContinue }: { docs: UploadedDoc[]; setDocs: React.Dispatch<React.SetStateAction<UploadedDoc[]>>; onBack: () => void; onContinue: () => void }) {
  return <div className="stageInner"><StageTitle eyebrow="PASO 3 DE 7" title="Esto encontramos" copy="Clasificamos los documentos y, si venían juntos, identificamos sus secciones. Confirma antes de seguir."/><div className="docList">{docs.map((doc) => <article className="docCard" key={doc.id}><div className="pdfIcon">PDF</div><div className="docMain"><div className="docTop"><div><h3>{doc.name}</h3><p>{doc.size}</p></div><span className="confidence">{doc.confidence}% confianza</span></div>{doc.segments ? <div className="segments">{doc.segments.map((s)=><div key={s.kind}><span className="segmentDot"/><p><b>{s.kind}</b><small>{s.pages} · {s.confidence}% confianza</small></p><button>Ver páginas</button></div>)}</div> : <label className="classificationSelect">Tipo detectado<select value={doc.kind} onChange={(e) => setDocs(current => current.map(d => d.id === doc.id ? {...d, kind: e.target.value as DocKind} : d))}>{["Cuenta clínica","PAM / liquidación","Contrato","Documento mixto","Por confirmar"].map(k=><option key={k}>{k}</option>)}</select></label>}</div></article>)}</div><div className="traceNote"><span>⌁</span><div><b>Trazabilidad desde el primer paso</b><p>Cada extracción guardará archivo, página, zona y nivel de confianza. Nada se desvincula de su fuente.</p></div></div><div className="stageActions"><button className="button ghost" onClick={onBack}>← Volver</button><button className="button primary" onClick={onContinue}>Confirmar clasificación →</button></div></div>;
}

function ValidationStep({ availability, onBack, onContinue }: { availability: { cuenta: boolean; pam: boolean; contrato: boolean }; onBack: () => void; onContinue: () => void }) {
  const rows = [{label:"Cuenta clínica", ok:availability.cuenta, detail:"Detalle de prestaciones y cobros"},{label:"PAM / liquidación", ok:availability.pam, detail:"Bonificación aplicada por la Isapre"},{label:"Contrato o plan", ok:availability.contrato, detail:"Reglas de cobertura y topes"}];
  return <div className="stageInner narrow"><StageTitle eyebrow="PASO 4 DE 7" title="Tu caso está listo para una primera revisión" copy="Revisamos si existe la documentación mínima para comenzar."/><div className="checkCard">{rows.map((r)=><div key={r.label} className={r.ok ? "ok" : "missing"}><span>{r.ok ? "✓" : "!"}</span><p><b>{r.label}</b><small>{r.detail}</small></p><em>{r.ok ? "Disponible" : "Pendiente"}</em></div>)}</div>{!availability.contrato && <div className="warningBox"><b>Puedes continuar sin contrato</b><p>Haremos el cruce Cuenta ↔ PAM. Para evaluar coberturas y topes con precisión, te pediremos el plan más adelante.</p></div>}<div className="stageActions"><button className="button ghost" onClick={onBack}>← Volver</button><button className="button primary" disabled={!availability.cuenta || !availability.pam} onClick={onContinue}>Iniciar procesamiento →</button></div></div>;
}

function ProcessingStep({ progress }: { progress: number }) {
  const phases = ["Separando documentos y páginas", "Leyendo prestaciones, códigos y montos", "Conectando Cuenta clínica ↔ PAM", "Construyendo trazabilidad", "Preparando resultado preliminar"];
  return <div className="processing stageInner narrow"><div className="processingMark"><span>R</span><i style={{"--progress": `${progress * 3.6}deg`} as React.CSSProperties}/></div><h1>Estamos ordenando tu caso</h1><p>El análisis conserva el origen de cada dato. Esto puede tomar unos minutos en documentos reales.</p><div className="progressBar"><span style={{width:`${progress}%`}}/></div><b>{progress}% completado</b><div className="phaseList">{phases.map((p,i)=><div key={p} className={progress >= (i+1)*20 ? "done" : progress >= i*20 ? "current" : ""}><span>{progress >= (i+1)*20 ? "✓" : i+1}</span>{p}</div>)}</div></div>;
}

function ResultStep({ hasContract, onContinue }: { hasContract: boolean; onContinue: () => void }) {
  return <div className="stageInner"><StageTitle eyebrow="PASO 6 DE 7" title="Ya tenemos un mapa preliminar" copy="Este resultado organiza la evidencia. Todavía no concluye que exista un cobro indebido."/><div className="resultHero"><div><span className="statusPill">ANÁLISIS PRELIMINAR COMPLETADO</span><h2>Tu caso tiene base suficiente para una revisión detallada</h2><p>Encontramos información que conviene reconstruir y contrastar antes de decidir un reclamo.</p></div><div className="score"><strong>78</strong><span>/100</span><small>Calidad documental</small></div></div><div className="metricGrid"><article><span>22</span><b>Páginas procesadas</b><small>1 archivo mixto</small></article><article><span>2</span><b>Tipos identificados</b><small>Cuenta + PAM</small></article><article><span>4</span><b>Puntos a revisar</b><small>Sin conclusiones definitivas</small></article></div><div className="findings"><h3>Primeras señales</h3><div><span className="findingIcon amber">↔</span><p><b>El cruce no es uno a uno</b><small>Hay líneas de cuenta que deben agruparse antes de compararlas con el PAM.</small></p><button>Ver evidencia</button></div><div><span className="findingIcon blue">≡</span><p><b>Existen múltiples liquidaciones</b><small>La hospitalización se distribuye en varios documentos PAM.</small></p><button>Ver evidencia</button></div>{!hasContract && <div><span className="findingIcon gray">+</span><p><b>Falta el contrato de salud</b><small>Es necesario para evaluar topes, porcentajes y exclusiones.</small></p><button>Agregar</button></div>}</div><div className="stageActions end"><button className="button primary" onClick={onContinue}>Ir al dashboard del caso →</button></div></div>;
}

function Dashboard({ docs, caseId }: { docs: UploadedDoc[]; caseId: string }) {
  return <div className="dashboard"><div className="dashboardHead"><div><p>CASO {caseId.slice(0,8).toUpperCase()}</p><h1>Hospitalización por apendicitis</h1><span>Clínica INDISA · Nueva Masvida</span></div><button className="button ghost">＋ Agregar documento</button></div><div className="dashboardGrid"><section className="casePanel overview"><div className="panelTitle"><h2>Estado del expediente</h2><span className="statusPill">EN REVISIÓN</span></div><div className="routeMap"><div className="complete"><span>✓</span><b>Documentos</b><small>{docs.length} archivo mixto</small></div><i/><div className="current"><span>2</span><b>Reconstrucción</b><small>Siguiente motor</small></div><i/><div><span>3</span><b>Hallazgos</b><small>Pendiente</small></div><i/><div><span>4</span><b>Reclamo</b><small>Pendiente</small></div></div></section><section className="casePanel nextAction"><p>SIGUIENTE MEJOR ACCIÓN</p><h2>Agrega tu contrato o plan de salud</h2><span>Así podremos calcular la cobertura que correspondía según tu plan.</span><button className="button primary">Subir contrato →</button></section><section className="casePanel evidence"><div className="panelTitle"><h2>Documentos y evidencia</h2><button>Ver todo</button></div>{docs.map(d=><div className="evidenceRow" key={d.id}><span className="miniPdf">PDF</span><p><b>{d.name}</b><small>{d.size} · Clasificado</small></p><em>✓</em></div>)}</section><section className="casePanel pendingEngines"><div className="panelTitle"><h2>Motores del caso</h2><span>Arquitectura preparada</span></div>{["Reconstrucción de cuenta","Cruce Cuenta ↔ PAM","Reglas de contrato","Hallazgos y evidencia","Generador de reclamos","Seguimiento de respuestas"].map((x,i)=><div key={x}><span>{i < 2 ? "↗" : "○"}</span><b>{x}</b><small>{i < 2 ? "Listo para activar" : "Próxima etapa"}</small></div>)}</section></div><div className="disclaimer"><b>Importante:</b> RevisaTuCuenta organiza información y genera hipótesis de revisión. No reemplaza una auditoría médica, asesoría legal ni garantiza una devolución.</div></div>;
}
