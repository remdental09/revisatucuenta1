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
  const normalized = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ");
  const isEmblematicIndisa = normalized.includes("indisa") && normalized.includes("apendicitis");
  let kind: DocKind = "Por confirmar";
  let confidence = 68;
  if ((n.includes("cuenta") && n.includes("pam")) || isEmblematicIndisa) {
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
    size: isEmblematicIndisa ? "22 páginas · PDF escaneado" : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    kind,
    confidence,
    segments: isEmblematicIndisa ? [
      { kind: "Cuenta clínica INDISA", pages: "Páginas 1–8", confidence: 96 },
      { kind: "PAM / liquidaciones Nueva Masvida", pages: "Páginas 9–22", confidence: 93 },
    ] : undefined,
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
          <p className="heroCopy">Comenzamos con tu cuenta clínica. Si también tienes PAM y contrato, los incorporamos después para profundizar la revisión.</p>
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
          {step === 5 && <ResultStep docs={docs} availability={availability} onContinue={() => setStep(6)}/>}
          {step === 6 && <Dashboard docs={docs} caseId={caseId} availability={availability}/>}
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
  const rows = [{label:"Cuenta clínica", ok:availability.cuenta, required:true, detail:"Único documento necesario para el primer informe"},{label:"PAM / liquidación", ok:availability.pam, required:false, detail:"Permite cruzar cobros y bonificaciones"},{label:"Contrato o plan", ok:availability.contrato, required:false, detail:"Permite evaluar cobertura, topes y exclusiones"}];
  return <div className="stageInner narrow"><StageTitle eyebrow="PASO 4 DE 7" title="Tu caso está listo para una primera revisión" copy="La Cuenta clínica permite generar el primer informe. PAM y contrato pueden incorporarse después."/><div className="checkCard">{rows.map((r)=><div key={r.label} className={r.ok ? "ok" : "optional"}><span>{r.ok ? "✓" : r.required ? "!" : "+"}</span><p><b>{r.label}</b><small>{r.detail}</small></p><em>{r.ok ? "Disponible" : r.required ? "Necesario" : "Opcional ahora"}</em></div>)}</div>{availability.cuenta && (!availability.pam || !availability.contrato) && <div className="successBox"><b>Puedes generar el primer informe ahora</b><p>El informe describirá la cuenta, su estructura y la documentación encontrada. Los cruces con PAM y las reglas del contrato se agregarán cuando esos documentos estén disponibles.</p></div>}<div className="stageActions"><button className="button ghost" onClick={onBack}>← Volver</button><button className="button primary" disabled={!availability.cuenta} onClick={onContinue}>Generar primer informe →</button></div></div>;
}

function ProcessingStep({ progress }: { progress: number }) {
  const phases = ["Separando documentos y páginas", "Leyendo prestaciones, códigos y montos", "Conectando Cuenta clínica ↔ PAM", "Construyendo trazabilidad", "Preparando resultado preliminar"];
  return <div className="processing stageInner narrow"><div className="processingMark"><span>R</span><i style={{"--progress": `${progress * 3.6}deg`} as React.CSSProperties}/></div><h1>Estamos ordenando tu caso</h1><p>El análisis conserva el origen de cada dato. Esto puede tomar unos minutos en documentos reales.</p><div className="progressBar"><span style={{width:`${progress}%`}}/></div><b>{progress}% completado</b><div className="phaseList">{phases.map((p,i)=><div key={p} className={progress >= (i+1)*20 ? "done" : progress >= i*20 ? "current" : ""}><span>{progress >= (i+1)*20 ? "✓" : i+1}</span>{p}</div>)}</div></div>;
}

function ResultStep({ docs, availability, onContinue }: { docs: UploadedDoc[]; availability: { cuenta: boolean; pam: boolean; contrato: boolean }; onContinue: () => void }) {
  const isEmblematic = docs.some(d => d.segments?.some(s => s.pages === "Páginas 1–8"));
  const typeCount = [availability.cuenta, availability.pam, availability.contrato].filter(Boolean).length;
  return <div className="stageInner"><StageTitle eyebrow="PASO 6 DE 7" title="Tu primer informe está disponible" copy="Este informe organiza la evidencia disponible. No concluye por sí solo que exista un cobro indebido."/><div className="resultHero"><div><span className="statusPill">PRIMER INFORME COMPLETADO</span><h2>La cuenta ya puede comenzar a revisarse</h2><p>{availability.pam ? "También encontramos PAM para preparar el cruce de cobros y bonificaciones." : "Puedes agregar el PAM más adelante para contrastar las bonificaciones."}</p></div><div className="score"><strong>{availability.pam ? 78 : 62}</strong><span>/100</span><small>Calidad documental</small></div></div><div className="metricGrid"><article><span>{isEmblematic ? "22" : docs.length}</span><b>{isEmblematic ? "Páginas procesadas" : "Documentos procesados"}</b><small>{docs.length} archivo{docs.length === 1 ? "" : "s"}</small></article><article><span>{typeCount}</span><b>Tipos identificados</b><small>{availability.pam ? "Cuenta + PAM" : "Cuenta clínica"}</small></article><article><span>{availability.pam ? 4 : 2}</span><b>Puntos a revisar</b><small>Sin conclusiones definitivas</small></article></div><div className="findings"><h3>Contenido del primer informe</h3><div><span className="findingIcon amber">≡</span><p><b>Estructura de la cuenta identificada</b><small>{isEmblematic ? "Cuenta clínica INDISA localizada en las páginas 1–8 del archivo original." : "Documento disponible para ordenar prestaciones, rubros y montos."}</small></p><button>Fuente</button></div>{availability.pam ? <div><span className="findingIcon blue">↔</span><p><b>PAM disponible para el siguiente cruce</b><small>{isEmblematic ? "Liquidaciones Nueva Masvida localizadas en las páginas 9–22." : "El cruce Cuenta ↔ PAM puede continuar sin contrato."}</small></p><button>Fuente</button></div> : <div><span className="findingIcon gray">+</span><p><b>PAM pendiente, sin bloquear el informe</b><small>Al agregarlo podremos contrastar cobros, prestaciones y bonificaciones.</small></p><button>Agregar después</button></div>}{!availability.contrato && <div><span className="findingIcon gray">+</span><p><b>Contrato opcional en esta etapa</b><small>Se solicitará únicamente para calcular cobertura, topes y exclusiones.</small></p><button>Agregar después</button></div>}</div><div className="stageActions end"><button className="button primary" onClick={onContinue}>Guardar e ir al dashboard →</button></div></div>;
}

function Dashboard({ docs, caseId, availability }: { docs: UploadedDoc[]; caseId: string; availability: { cuenta: boolean; pam: boolean; contrato: boolean } }) {
  const [reportOpen, setReportOpen] = useState(false);
  const isEmblematic = docs.some(d => d.segments?.some(s => s.pages === "Páginas 1–8"));
  return <div className="dashboard"><div className="dashboardHead"><div><p>CASO {caseId.slice(0,8).toUpperCase()}</p><h1>Hospitalización por apendicitis</h1><span>Clínica INDISA · Nueva Masvida</span></div><button className="button ghost">＋ Agregar documento</button></div><div className="dashboardGrid"><section className="casePanel overview"><div className="panelTitle"><h2>Estado del expediente</h2><span className="statusPill">PRIMER INFORME LISTO</span></div><div className="routeMap"><div className="complete"><span>✓</span><b>Documentos</b><small>{docs.length} archivo{docs.length === 1 ? "" : "s"}</small></div><i/><div className="complete"><span>✓</span><b>Primer informe</b><small>Disponible</small></div><i/><div className="current"><span>3</span><b>Cruces</b><small>{availability.pam ? "Cuenta ↔ PAM" : "Espera PAM"}</small></div><i/><div><span>4</span><b>Reclamo</b><small>Pendiente</small></div></div></section><section className="casePanel nextAction"><p>INFORME DISPONIBLE</p><h2>Revisa tu primer informe</h2><span>No necesitas contrato para abrirlo. El contrato se usará después para calcular coberturas y topes.</span><button className="button primary" onClick={() => setReportOpen(true)}>Abrir primer informe →</button></section><section className="casePanel evidence"><div className="panelTitle"><h2>Documentos y evidencia</h2><button>Ver todo</button></div>{docs.map(d=><div className="evidenceRow" key={d.id}><span className="miniPdf">PDF</span><p><b>{d.name}</b><small>{d.size} · Clasificado</small></p><em>✓</em></div>)}</section><section className="casePanel pendingEngines"><div className="panelTitle"><h2>Motores del caso</h2><span>Avance por etapas</span></div>{["Primer informe documental","Reconstrucción de cuenta","Cruce Cuenta ↔ PAM","Reglas de contrato","Hallazgos y evidencia","Generador de reclamos"].map((x,i)=><div key={x}><span>{i === 0 ? "✓" : i < 3 ? "↗" : "○"}</span><b>{x}</b><small>{i === 0 ? "Completado" : i < 3 ? "Listo para continuar" : "Etapa posterior"}</small></div>)}</section></div><div className="disclaimer"><b>Importante:</b> RevisaTuCuenta organiza información y genera hipótesis de revisión. No reemplaza una auditoría médica, asesoría legal ni garantiza una devolución.</div>{reportOpen && <div className="reportOverlay" role="dialog" aria-modal="true" aria-labelledby="report-title"><button className="reportBackdrop" aria-label="Cerrar informe" onClick={() => setReportOpen(false)}/><article className="reportSheet"><header><div><p>REVISATUCUENTA · INFORME PRELIMINAR</p><h2 id="report-title">Primer informe del caso</h2><span>Hospitalización por apendicitis</span></div><button onClick={() => setReportOpen(false)} aria-label="Cerrar">×</button></header><div className="reportStatus"><span>✓</span><p><b>Informe generado sin contrato</b><small>El contrato será necesario únicamente para evaluar cobertura, topes y exclusiones.</small></p></div><section><h3>1. Documentación identificada</h3><div className="reportRows"><div><b>Cuenta clínica</b><span>{isEmblematic ? "INDISA · páginas 1–8" : "Disponible"}</span><em>Verificada</em></div><div><b>PAM / liquidaciones</b><span>{availability.pam ? (isEmblematic ? "Nueva Masvida · páginas 9–22" : "Disponible") : "No agregado"}</span><em className={availability.pam ? "" : "pending"}>{availability.pam ? "Verificado" : "Opcional ahora"}</em></div><div><b>Contrato de salud</b><span>{availability.contrato ? "Disponible" : "No agregado"}</span><em className={availability.contrato ? "" : "pending"}>{availability.contrato ? "Verificado" : "Etapa posterior"}</em></div></div></section><section><h3>2. Resultado de esta etapa</h3><ul><li>La Cuenta clínica es suficiente para iniciar la revisión documental.</li><li>{isEmblematic ? "El archivo mixto fue separado lógicamente entre Cuenta clínica y PAM." : "El documento quedó clasificado y vinculado a su fuente original."}</li><li>{availability.pam ? "El PAM permitirá continuar con el cruce de prestaciones y bonificaciones." : "La ausencia de PAM no impide este primer informe."}</li><li>La ausencia de contrato no bloquea el informe ni la reconstrucción inicial.</li></ul></section><section><h3>3. Próximo análisis</h3><p>Ordenar prestaciones y rubros de la cuenta, consolidar las liquidaciones disponibles y detectar diferencias que requieran explicación. Las conclusiones sobre cobertura contractual se incorporarán solamente cuando exista el plan de salud.</p></section><footer><span>Informe preliminar · No constituye auditoría médica ni asesoría legal.</span><button className="button primary" onClick={() => setReportOpen(false)}>Volver al caso</button></footer></article></div>}</div>;
}
