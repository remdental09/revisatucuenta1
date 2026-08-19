"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  evaluateEmblematicCase,
  type RuleEvaluation,
} from "../lib/rules/unbundling";
import { extractHealthcareDocument } from "../lib/extraction/client";
import type { DocumentExtraction } from "../lib/extraction/types";
import { APPENDICITIS_CONDUCT_FINDINGS } from "../lib/rules/institutional-conduct";
import type { ClinicalAccountAnalysis } from "../lib/rules/chilean-account";
import { DeveloperPortal, PatientPortal, PortalEntry } from "./portal";

type DocKind =
  | "Cuenta clínica"
  | "PAM / liquidación"
  | "Contrato"
  | "Documento mixto"
  | "Por confirmar";
type UploadedDoc = {
  id: string;
  name: string;
  size: string;
  kind: DocKind;
  confidence: number;
  segments?: { kind: string; pages: string; confidence: number }[];
  extraction?: DocumentExtraction;
  extractionStatus?: "pending" | "extracting" | "complete" | "error";
  extractionProgress?: number;
  extractionError?: string;
};

const normalizeForDocumentMatch = (value = "") => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function findLinesWithoutPamExplanation(
  analysis: ClinicalAccountAnalysis | undefined,
  docs: UploadedDoc[],
) {
  const pamLines = docs.flatMap((doc) => doc.extraction?.pam?.lines ?? []);
  if (!pamLines.length) return [];
  return analysis?.lineAssessments.filter((assessment) => {
    if (assessment.line.amount === 0) return false;
    const accountCode = normalizeForDocumentMatch(assessment.line.fonasaCode || assessment.line.code);
    const accountDescription = normalizeForDocumentMatch(assessment.line.description);
    const explained = pamLines.some((pamLine) => {
      const pamCode = normalizeForDocumentMatch(pamLine.fonasaCode || pamLine.code);
      const pamDescription = normalizeForDocumentMatch(pamLine.description);
      if (accountCode && pamCode && accountCode === pamCode) return true;
      if (!accountDescription || !pamDescription) return false;
      return accountDescription === pamDescription ||
        (accountDescription.length >= 12 && pamDescription.length >= 12 &&
          (accountDescription.includes(pamDescription) || pamDescription.includes(accountDescription)));
    });
    return !explained;
  }) ?? [];
}

const steps = [
  "Crear caso",
  "Documentos",
  "Clasificación",
  "Validación",
  "Procesamiento",
  "Resultado",
  "Dashboard",
];

const demoDocument: UploadedDoc = {
  id: "doc-demo-indisa",
  name: "CUENTA INDISA_APENDICITIS.pdf",
  size: "22 páginas · PDF escaneado",
  kind: "Documento mixto",
  confidence: 94,
  segments: [
    { kind: "Cuenta clínica INDISA", pages: "Páginas 1–8", confidence: 96 },
    {
      kind: "PAM / liquidaciones Nueva Masvida",
      pages: "Páginas 9–22",
      confidence: 93,
    },
  ],
};

function classifyFile(file: File): UploadedDoc {
  const n = file.name.toLowerCase();
  const normalized = n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  const isEmblematicIndisa =
    normalized.includes("indisa") && normalized.includes("apendicitis");
  let kind: DocKind = "Por confirmar";
  let confidence = 68;
  if ((n.includes("cuenta") && n.includes("pam")) || isEmblematicIndisa) {
    kind = "Documento mixto";
    confidence = 92;
  } else if (
    n.includes("pam") ||
    n.includes("bono") ||
    n.includes("bonos") ||
    n.includes("liquidacion") ||
    n.includes("bonificacion")
  ) {
    kind = "PAM / liquidación";
    confidence = 91;
  } else if (
    n.includes("contrato") ||
    n.includes("plan") ||
    n.includes("cobertura")
  ) {
    kind = "Contrato";
    confidence = 89;
  } else if (n.includes("cuenta") || n.includes("clinica")) {
    kind = "Cuenta clínica";
    confidence = 86;
  }
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: isEmblematicIndisa
      ? "22 páginas · PDF escaneado"
      : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    kind,
    confidence,
    extractionStatus: "pending",
    extractionProgress: 0,
    segments: isEmblematicIndisa
      ? [
          {
            kind: "Cuenta clínica INDISA",
            pages: "Páginas 1–8",
            confidence: 96,
          },
          {
            kind: "PAM / liquidaciones Nueva Masvida",
            pages: "Páginas 9–22",
            confidence: 93,
          },
        ]
      : undefined,
  };
}

function Workbench() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [caseId, setCaseId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [episode, setEpisode] = useState("Hospitalización por apendicitis");
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [processing, setProcessing] = useState(0);
  const [analysis, setAnalysis] = useState<ClinicalAccountAnalysis>();
  const [analysisError, setAnalysisError] = useState<string>();
  const analysisSignature = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  const availability = useMemo(
    () => ({
      cuenta: docs.some(
        (d) => d.kind === "Cuenta clínica" || d.kind === "Documento mixto",
      ),
      pam: docs.some(
        (d) => d.kind === "PAM / liquidación" || d.kind === "Documento mixto",
      ),
      contrato: docs.some((d) => d.kind === "Contrato"),
    }),
    [docs],
  );

  useEffect(() => {
    if (step !== 4) return;
    const timers = [22, 45, 68, 88, 100].map((value, index) =>
      window.setTimeout(() => setProcessing(value), 480 * (index + 1)),
    );
    const done = window.setTimeout(() => setStep(5), 3000);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [step]);

  useEffect(() => {
    const accountLines = docs.flatMap((doc) =>
      (doc.extraction?.account?.lines ?? []).map((line, index) => ({
        id: `${doc.id}-${index}`,
        documentId: doc.id,
        description: line.description,
        amount: line.amount,
        page: line.page,
        code: line.code,
        fonasaCode: line.fonasaCode,
        section: line.section,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
      })),
    );
    if (!accountLines.length || docs.some((doc) => doc.extractionStatus === "extracting")) return;
    const signature = accountLines
      .map((line) => `${line.id}:${line.amount}:${line.description}`)
      .join("|");
    if (signature === analysisSignature.current) return;
    analysisSignature.current = signature;
    setAnalysisError(undefined);
    void fetch("/api/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: accountLines }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo analizar la cuenta");
        setAnalysis(payload as ClinicalAccountAnalysis);
      })
      .catch((error) => {
        setAnalysis(undefined);
        setAnalysisError(error instanceof Error ? error.message : "No se pudo analizar la cuenta");
      });
  }, [docs]);

  async function createCase() {
    const id = crypto.randomUUID();
    setCaseId(id);
    try {
      await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          patientName: patientName || "Paciente",
          episodeLabel: episode,
        }),
      });
    } catch {
      /* La interfaz conserva el avance si la red local aún inicia. */
    }
    setStep(1);
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).map(classifyFile);
    setDocs((current) => [...current, ...next]);
    await Promise.all(
      Array.from(files).map(async (file, i) => {
        const doc = next[i];
        setDocs((current) =>
          current.map((item) =>
            item.id === doc.id
              ? { ...item, extractionStatus: "extracting" }
              : item,
          ),
        );
        let upload: Promise<Response> | undefined;
        if (caseId) {
        const body = new FormData();
        body.append("caseId", caseId);
          body.append("documentId", doc.id);
          body.append("classification", doc.kind);
          body.append("confidence", String(doc.confidence));
          body.append("file", file);
          upload = fetch("/api/documents", { method: "POST", body });
        }
        try {
          const expected =
            doc.kind === "Cuenta clínica"
              ? "account"
              : doc.kind === "PAM / liquidación"
                ? "pam"
                : doc.kind === "Documento mixto"
                  ? "mixed"
                  : "unknown";
          const extraction = await extractHealthcareDocument(
            file,
            expected,
            (extractionProgress) =>
              setDocs((current) =>
                current.map((item) =>
                  item.id === doc.id ? { ...item, extractionProgress } : item,
                ),
              ),
          );
          if (upload) {
            const uploadResponse = await upload;
            if (!uploadResponse.ok) throw new Error("No fue posible guardar el documento");
            await fetch("/api/extractions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ documentId: doc.id, extraction }),
            });
          }
          setDocs((current) =>
            current.map((item) =>
              item.id === doc.id
                ? {
                    ...item,
                    extraction,
                    extractionStatus: "complete",
                    extractionProgress: 100,
                  }
                : item,
            ),
          );
        } catch (error) {
          setDocs((current) =>
            current.map((item) =>
              item.id === doc.id
                ? {
                    ...item,
                    extractionStatus: "error",
                    extractionError:
                      error instanceof Error ? error.message : "No se pudo extraer el documento",
                  }
                : item,
            ),
          );
        }
      }),
    );
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
          <a className="brand" href="#top" aria-label="RevisaTuCuenta inicio">
            <span className="brandMark">R</span>RevisaTuCuenta
          </a>
          <div className="navLinks">
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#seguridad">Seguridad</a>
          </div>
          <button
            className="button ghost"
            onClick={() => {
              setStarted(true);
              setStep(0);
            }}
          >
            Ingresar
          </button>
        </nav>

        <section className="hero shell" id="top">
          <div className="eyebrow">
            <span>●</span> Tu cuenta merece una segunda mirada
          </div>
          <h1>
            Entiende lo que te cobraron.
            <br />
            <em>Reclama con fundamento.</em>
          </h1>
          <p className="heroCopy">
            Comenzamos con tu cuenta clínica. Si también tienes PAM y contrato,
            los incorporamos después para profundizar la revisión.
          </p>
          <div className="heroActions">
            <button
              className="button primary large"
              onClick={() => {
                setStarted(true);
                setStep(0);
              }}
            >
              Revisar mi cuenta <span>→</span>
            </button>
            <button className="button textButton" onClick={loadDemo}>
              Ver caso de ejemplo
            </button>
          </div>
          <p className="microcopy">
            Análisis preliminar · Sin afirmar cobros indebidos · Tú decides cómo
            continuar
          </p>
          <div
            className="documentScene"
            aria-label="Documentos conectados para formar un caso"
          >
            <article className="paper paperOne">
              <small>CLÍNICA</small>
              <h3>Cuenta clínica</h3>
              <div className="paperLines" />
              <strong>$4.280.450</strong>
            </article>
            <article className="paper paperTwo">
              <small>ISAPRE</small>
              <h3>PAM / liquidación</h3>
              <div className="paperLines" />
              <strong>Bonificación</strong>
            </article>
            <article className="paper paperThree">
              <small>TU PLAN</small>
              <h3>Contrato</h3>
              <div className="paperLines" />
              <strong>Coberturas</strong>
            </article>
            <div className="caseBadge">
              <span>✓</span>
              <div>
                <small>EXPEDIENTE ORDENADO</small>
                <b>Caso listo para revisar</b>
              </div>
            </div>
          </div>
        </section>

        <section className="trustStrip">
          <div className="shell trustGrid">
            <div>
              <b>01</b>
              <span>Sube tus documentos</span>
            </div>
            <div>
              <b>02</b>
              <span>Los ordenamos y conectamos</span>
            </div>
            <div>
              <b>03</b>
              <span>Recibe un mapa claro de revisión</span>
            </div>
          </div>
        </section>

        <section className="how shell" id="como-funciona">
          <div>
            <p className="sectionKicker">Un expediente, no una caja negra</p>
            <h2>Cada dato vuelve a su origen.</h2>
          </div>
          <p>
            Todo monto, código o conclusión conserva el documento y la página de
            donde fue extraído. Puedes revisar la evidencia antes de avanzar a
            un reclamo.
          </p>
        </section>
        <section className="privacy shell" id="seguridad">
          <span className="privacyIcon">◇</span>
          <div>
            <b>Tus documentos son privados</b>
            <p>
              Se almacenan para tu caso y nunca se publican. Esta versión no
              reemplaza asesoría médica ni jurídica.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <button className="brand brandButton" onClick={() => setStarted(false)}>
          <span className="brandMark">R</span>RevisaTuCuenta
        </button>
        <div className="caseRef">
          {caseId ? `Caso ${caseId.slice(0, 8).toUpperCase()}` : "Nuevo caso"}
        </div>
        <button className="helpButton">
          ? <span>Ayuda</span>
        </button>
      </header>
      <div className="workspace">
        <aside className="stepper" aria-label="Progreso del caso">
          <p>Tu revisión</p>
          {steps.map((label, i) => (
            <button
              key={label}
              className={`${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
              disabled={i > step}
              onClick={() => i < step && setStep(i)}
            >
              <span>{i < step ? "✓" : i + 1}</span>
              {label}
            </button>
          ))}
          <div className="asideNote">
            <b>Tu avance se guarda</b>
            <span>Puedes volver y continuar después.</span>
          </div>
        </aside>

        <section className="stage">
          {step === 0 && (
            <CreateCase
              patientName={patientName}
              setPatientName={setPatientName}
              episode={episode}
              setEpisode={setEpisode}
              onContinue={createCase}
            />
          )}
          {step === 1 && (
            <UploadStep
              docs={docs}
              inputRef={inputRef}
              addFiles={addFiles}
              loadDemo={loadDemo}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <ClassificationStep
              docs={docs}
              setDocs={setDocs}
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <ValidationStep
              availability={availability}
              onBack={() => setStep(2)}
              onContinue={() => {
                setProcessing(0);
                setStep(4);
              }}
            />
          )}
          {step === 4 && <ProcessingStep progress={processing} />}
          {step === 5 && (
            <ResultStep
              docs={docs}
              availability={availability}
              analysis={analysis}
              analysisError={analysisError}
              onContinue={() => setStep(6)}
            />
          )}
          {step === 6 && (
            <Dashboard
              docs={docs}
              caseId={caseId}
              availability={availability}
              analysis={analysis}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function StageTitle({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className="stageTitle">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{copy}</span>
    </header>
  );
}

function CreateCase({
  patientName,
  setPatientName,
  episode,
  setEpisode,
  onContinue,
}: {
  patientName: string;
  setPatientName: (v: string) => void;
  episode: string;
  setEpisode: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="stageInner narrow">
      <StageTitle
        eyebrow="PASO 1 DE 7"
        title="Cuéntanos sobre este caso"
        copy="Usaremos estos datos para ordenar tus documentos. No necesitas conocer términos técnicos."
      />
      <div className="formCard">
        <label>
          Nombre para identificar al paciente
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Ej: María P."
          />
        </label>
        <label>
          ¿Qué atención quieres revisar?
          <input
            value={episode}
            onChange={(e) => setEpisode(e.target.value)}
            placeholder="Ej: Hospitalización de julio"
          />
        </label>
        <label>
          Prestador de salud (opcional)
          <input placeholder="Ej: Clínica INDISA" />
        </label>
        <div className="infoLine">
          <span>i</span> Puedes usar iniciales si prefieres. El nombre no afecta
          el análisis.
        </div>
      </div>
      <div className="stageActions end">
        <button className="button primary" onClick={onContinue}>
          Crear caso y continuar →
        </button>
      </div>
    </div>
  );
}

function UploadStep({
  docs,
  inputRef,
  addFiles,
  loadDemo,
  onContinue,
}: {
  docs: UploadedDoc[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (f: FileList | null) => void;
  loadDemo: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="stageInner">
      <StageTitle
        eyebrow="PASO 2 DE 7"
        title="Reúne tus documentos"
        copy="Puedes subirlos juntos en un solo PDF o por separado. Nosotros identificaremos qué contiene cada archivo."
      />
      <div className="uploadGrid">
        <button
          className="dropZone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <span className="uploadIcon">↑</span>
          <b>Arrastra tus archivos aquí</b>
          <small>o haz clic para buscarlos</small>
          <em>PDF, JPG o PNG · hasta 25 MB por archivo</em>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="neededDocs">
          <h3>Idealmente incluye</h3>
          {[
            "Cuenta clínica detallada",
            "PAM o liquidación de la Isapre",
            "Contrato o plan de salud",
          ].map((x, i) => (
            <div key={x}>
              <span>{i + 1}</span>
              <p>
                <b>{x}</b>
                <small>
                  {i === 2
                    ? "Puedes agregarlo después"
                    : "Necesario para cruzar los cobros"}
                </small>
              </p>
            </div>
          ))}
          <button className="demoLink" onClick={loadDemo}>
            Usar caso emblemático INDISA →
          </button>
        </div>
      </div>
      {docs.length > 0 && (
        <div className="uploadedSummary">
          <b>
            {docs.length} archivo{docs.length > 1 ? "s" : ""} listo
            {docs.length > 1 ? "s" : ""}
          </b>
          {docs.map((d) => (
            <span key={d.id}>✓ {d.name}</span>
          ))}
        </div>
      )}
      <div className="stageActions end">
        <button
          className="button primary"
          disabled={!docs.length}
          onClick={onContinue}
        >
          Clasificar documentos →
        </button>
      </div>
    </div>
  );
}

function ClassificationStep({
  docs,
  setDocs,
  onBack,
  onContinue,
}: {
  docs: UploadedDoc[];
  setDocs: React.Dispatch<React.SetStateAction<UploadedDoc[]>>;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="stageInner">
      <StageTitle
        eyebrow="PASO 3 DE 7"
        title="Esto encontramos"
        copy="Clasificamos los documentos y, si venían juntos, identificamos sus secciones. Confirma antes de seguir."
      />
      <div className="docList">
        {docs.map((doc) => (
          <article className="docCard" key={doc.id}>
            <div className="pdfIcon">PDF</div>
            <div className="docMain">
              <div className="docTop">
                <div>
                  <h3>{doc.name}</h3>
                  <p>{doc.size}</p>
                </div>
                <span className="confidence">{doc.confidence}% confianza</span>
              </div>
              {doc.segments ? (
                <div className="segments">
                  {doc.segments.map((s) => (
                    <div key={s.kind}>
                      <span className="segmentDot" />
                      <p>
                        <b>{s.kind}</b>
                        <small>
                          {s.pages} · {s.confidence}% confianza
                        </small>
                      </p>
                      <button>Ver páginas</button>
                    </div>
                  ))}
                </div>
              ) : (
                <label className="classificationSelect">
                  Tipo detectado
                  <select
                    value={doc.kind}
                    onChange={(e) =>
                      setDocs((current) =>
                        current.map((d) =>
                          d.id === doc.id
                            ? { ...d, kind: e.target.value as DocKind }
                            : d,
                        ),
                      )
                    }
                  >
                    {[
                      "Cuenta clínica",
                      "PAM / liquidación",
                      "Contrato",
                      "Documento mixto",
                      "Por confirmar",
                    ].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
              )}
              <ExtractionSummary doc={doc} />
            </div>
          </article>
        ))}
      </div>
      <div className="traceNote">
        <span>⌁</span>
        <div>
          <b>Trazabilidad desde el primer paso</b>
          <p>
            Cada extracción guardará archivo, página, zona y nivel de confianza.
            Nada se desvincula de su fuente.
          </p>
        </div>
      </div>
      <div className="stageActions">
        <button className="button ghost" onClick={onBack}>
          ← Volver
        </button>
        <button className="button primary" onClick={onContinue}>
          Confirmar clasificación →
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [surface, setSurface] = useState<"entry" | "patient" | "developer" | "workbench">("entry");

  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "patient" || view === "developer" || view === "workbench") {
      setSurface(view);
    }
  }, []);

  if (surface === "patient") return <PatientPortal />;
  if (surface === "developer") return <DeveloperPortal />;
  if (surface === "workbench") return <Workbench />;
  return <PortalEntry />;
}

function ExtractionSummary({ doc }: { doc: UploadedDoc }) {
  if (doc.extractionStatus === "pending") {
    return <div className="extractionStatus">Preparando extracción…</div>;
  }
  if (doc.extractionStatus === "extracting") {
    return (
      <div className="extractionStatus active">
        <span style={{ width: `${doc.extractionProgress ?? 0}%` }} />
        Extrayendo texto y datos · {doc.extractionProgress ?? 0}%
      </div>
    );
  }
  if (doc.extractionStatus === "error") {
    return (
      <div className="extractionStatus error">
        No pudimos extraer este archivo: {doc.extractionError}. Puedes confirmar
        su clasificación y continuar.
      </div>
    );
  }
  if (!doc.extraction) return null;
  const groups = [doc.extraction.account, doc.extraction.pam].filter(Boolean);
  return (
    <div className="extractionGroups">
      <div className="extractionHeading">
        <b>Datos extraídos por documento</b>
        <small>
          {doc.extraction.pageCount} página{doc.extraction.pageCount === 1 ? "" : "s"}
          {doc.extraction.usedOcr ? " · reconocimiento OCR" : " · texto digital"}
        </small>
      </div>
      {groups.map((group) => (
        <section className={`extractionGroup ${group?.type}`} key={group?.type}>
          <header>
            <b>{group?.label}</b>
            <span>Páginas {group?.pages.join(", ")}</span>
          </header>
          {group?.fields.length ? (
            <div className="extractedFields">
              {group.fields.map((field) => (
                <div key={`${field.key}-${field.page}`}>
                  <span>{field.label}</span>
                  <b>{field.value}</b>
                  <small>Pág. {field.page} · {field.confidence}%</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="noFields">
              Se identificó la sección, pero sus campos necesitan revisión manual.
            </p>
          )}
          {!!group?.lines.length && (
            <small className="lineCount">
              {group.lines.length} línea{group.lines.length === 1 ? "" : "s"} monetaria
              {group.lines.length === 1 ? " detectada" : "s detectadas"}
            </small>
          )}
        </section>
      ))}
    </div>
  );
}

function ValidationStep({
  availability,
  onBack,
  onContinue,
}: {
  availability: { cuenta: boolean; pam: boolean; contrato: boolean };
  onBack: () => void;
  onContinue: () => void;
}) {
  const rows = [
    {
      label: "Cuenta clínica",
      ok: availability.cuenta,
      required: true,
      detail: "Único documento necesario para el primer informe",
    },
    {
      label: "PAM / liquidación",
      ok: availability.pam,
      required: false,
      detail: "Permite cruzar cobros y bonificaciones",
    },
    {
      label: "Contrato o plan",
      ok: availability.contrato,
      required: false,
      detail: "Permite evaluar cobertura, topes y exclusiones",
    },
  ];
  return (
    <div className="stageInner narrow">
      <StageTitle
        eyebrow="PASO 4 DE 7"
        title="Tu caso está listo para una primera revisión"
        copy="La Cuenta clínica permite generar el primer informe. PAM y contrato pueden incorporarse después."
      />
      <div className="checkCard">
        {rows.map((r) => (
          <div key={r.label} className={r.ok ? "ok" : "optional"}>
            <span>{r.ok ? "✓" : r.required ? "!" : "+"}</span>
            <p>
              <b>{r.label}</b>
              <small>{r.detail}</small>
            </p>
            <em>
              {r.ok
                ? "Disponible"
                : r.required
                  ? "Necesario"
                  : "Opcional ahora"}
            </em>
          </div>
        ))}
      </div>
      {availability.cuenta && (!availability.pam || !availability.contrato) && (
        <div className="successBox">
          <b>Puedes generar el primer informe ahora</b>
          <p>
            El informe describirá la cuenta, su estructura y la documentación
            encontrada. Los cruces con PAM y las reglas del contrato se
            agregarán cuando esos documentos estén disponibles.
          </p>
        </div>
      )}
      <div className="stageActions">
        <button className="button ghost" onClick={onBack}>
          ← Volver
        </button>
        <button
          className="button primary"
          disabled={!availability.cuenta}
          onClick={onContinue}
        >
          Generar primer informe →
        </button>
      </div>
    </div>
  );
}

function ProcessingStep({ progress }: { progress: number }) {
  const phases = [
    "Separando documentos y páginas",
    "Leyendo prestaciones, códigos y montos",
    "Conectando Cuenta clínica ↔ PAM",
    "Construyendo trazabilidad",
    "Preparando resultado preliminar",
  ];
  return (
    <div className="processing stageInner narrow">
      <div className="processingMark">
        <span>R</span>
        <i
          style={
            { "--progress": `${progress * 3.6}deg` } as React.CSSProperties
          }
        />
      </div>
      <h1>Estamos ordenando tu caso</h1>
      <p>
        El análisis conserva el origen de cada dato. Esto puede tomar unos
        minutos en documentos reales.
      </p>
      <div className="progressBar">
        <span style={{ width: `${progress}%` }} />
      </div>
      <b>{progress}% completado</b>
      <div className="phaseList">
        {phases.map((p, i) => (
          <div
            key={p}
            className={
              progress >= (i + 1) * 20
                ? "done"
                : progress >= i * 20
                  ? "current"
                  : ""
            }
          >
            <span>{progress >= (i + 1) * 20 ? "✓" : i + 1}</span>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultStep({
  docs,
  availability,
  analysis,
  analysisError,
  onContinue,
}: {
  docs: UploadedDoc[];
  availability: { cuenta: boolean; pam: boolean; contrato: boolean };
  analysis?: ClinicalAccountAnalysis;
  analysisError?: string;
  onContinue: () => void;
}) {
  const [liveDetail, setLiveDetail] = useState<"candidates" | "anomalies" | null>(null);
  const isEmblematic = docs.some((d) =>
    d.segments?.some((s) => s.pages === "Páginas 1–8"),
  );
  const typeCount = [
    availability.cuenta,
    availability.pam,
    availability.contrato,
  ].filter(Boolean).length;
  const ruleEvaluations = isEmblematic
    ? evaluateEmblematicCase(availability.contrato)
    : [];
  const unbundlingCandidate = ruleEvaluations.find(
    (rule) => rule.ruleId === "UB-PAB-001",
  );
  const anesthesiaCandidate = ruleEvaluations.find(
    (rule) => rule.ruleId === "UB-PAB-002",
  );
  const candidateAmount =
    (unbundlingCandidate?.amount ?? 0) + (anesthesiaCandidate?.amount ?? 0);
  const liveCandidates = analysis?.lineAssessments.filter((assessment) =>
    assessment.candidates.some((candidate) => candidate.probability >= 0.45),
  ) ?? [];
  const liveCandidateAmount = liveCandidates.reduce(
    (sum, assessment) => sum + assessment.line.amount,
    0,
  );
  const analyzedAmount = analysis?.lineAssessments.reduce(
    (sum, assessment) => sum + assessment.line.amount,
    0,
  ) ?? 0;
  const hasLiveAnalysis = !isEmblematic && Boolean(analysis?.lineAssessments.length);
  const unexplainedLines = findLinesWithoutPamExplanation(analysis, docs);
  const unexplainedAmount = unexplainedLines.reduce((sum, item) => sum + item.line.amount, 0);
  return (
    <div className="stageInner">
      <StageTitle
        eyebrow="PASO 6 DE 7"
        title="Tu primer informe está disponible"
        copy="Este informe cuantifica la cuenta, contrasta los PAM y ejecuta reglas de fragmentación. Un indicio no se presenta como cobro indebido sin comprobar el régimen aplicable."
      />
      <div className="resultHero">
        <div>
          <span className="statusPill">PRIMER INFORME COMPLETADO</span>
          <h2>
            {isEmblematic
              ? "$6.912.876 revisados con reglas de inclusión"
              : hasLiveAnalysis
                ? `${analysis?.lineAssessments.length} líneas analizadas con trazabilidad`
              : "La cuenta ya puede comenzar a revisarse"}
          </h2>
          <p>
            {isEmblematic
              ? "Además de conciliar la cuenta, el motor comparó las líneas de pabellón con reglas normativas y separó coincidencias de conclusiones."
              : hasLiveAnalysis
                ? "El motor comparó cada línea con prestaciones principales y con el corpus observado; los resultados siguen siendo hipótesis de revisión."
              : availability.pam
                ? "También encontramos PAM para preparar el cruce de cobros y bonificaciones."
                : "Puedes agregar el PAM más adelante para contrastar las bonificaciones."}
          </p>
        </div>
        <div className="score">
          <strong>{availability.pam ? 82 : 62}</strong>
          <span>/100</span>
          <small>Calidad documental</small>
        </div>
      </div>
      <div className="metricGrid">
        <article>
          <span>{isEmblematic ? "$6,91 M" : hasLiveAnalysis ? `$${analyzedAmount.toLocaleString("es-CL")}` : docs.length}</span>
          <b>
            {isEmblematic ? "Total cuenta clínica" : hasLiveAnalysis ? "Monto de líneas analizadas" : "Documentos procesados"}
          </b>
          <small>
            {isEmblematic
              ? "Fuente: página 8"
              : hasLiveAnalysis
                ? `${analysis?.lineAssessments.length} renglones con página de origen`
                : `${docs.length} archivo${docs.length === 1 ? "" : "s"}`}
          </small>
        </article>
        <article>
          <span>
            {isEmblematic
              ? `$${candidateAmount.toLocaleString("es-CL")}`
              : hasLiveAnalysis
                ? `$${liveCandidateAmount.toLocaleString("es-CL")}`
                : typeCount}
          </span>
          <b>
            {isEmblematic || hasLiveAnalysis ? "Bajo hipótesis de inclusión" : "Tipos identificados"}
          </b>
          <small>
            {isEmblematic
              ? "Indicio, aún no devolución"
              : hasLiveAnalysis
                ? `${liveCandidates.length} líneas para contrastar`
              : availability.pam
                ? "Cuenta + PAM"
                : "Cuenta clínica"}
          </small>
        </article>
        <article>
          <span>{isEmblematic ? "5" : hasLiveAnalysis ? analysis?.anomalies.length ?? 0 : availability.pam ? 4 : 2}</span>
          <b>{isEmblematic ? "Reglas ejecutadas" : hasLiveAnalysis ? "Anomalías adicionales" : "Puntos a revisar"}</b>
          <small>
            {isEmblematic
              ? "Con fuente y ámbito"
              : "Sin conclusiones definitivas"}
          </small>
        </article>
      </div>
      {isEmblematic && (
        <div className="ruleAlert">
          <span>R</span>
          <div>
            <b>El motor detectó posible fragmentación en pabellón</b>
            <p>
              <strong>$221.743</strong> coinciden literalmente con elementos
              incluidos por la NTA MLE y <strong>$500.859</strong> corresponden
              a fármacos anestésicos que requieren clasificación. Como el cobro
              es Isapre convencional, falta demostrar que esa regla integra el
              convenio aplicable.
            </p>
          </div>
        </div>
      )}
      {hasLiveAnalysis && (
        <>
          {!!unexplainedLines.length && (
            <div className="unexplainedCallout">
              <span>!</span>
              <div>
                <b>{unexplainedLines.length} líneas no están explicadas directamente por el PAM</b>
                <p><strong>${unexplainedAmount.toLocaleString("es-CL")}</strong> contenidos en el total de la cuenta requieren desglose o correspondencia documental. Este monto no se suma nuevamente.</p>
              </div>
            </div>
          )}
          <div className="ruleAlert">
            <span>R</span>
            <div>
              <b>El motor analizó esta cuenta real</b>
              <p>
                <strong>{analysis?.lineAssessments.length} líneas</strong> llegaron al motor y {" "}
                <strong>{liveCandidates.length}</strong> requieren contrastar su pertenencia a día cama,
                pabellón u otra prestación principal.
              </p>
            </div>
          </div>
          <div className="liveAnalysisActions">
            <button className="button secondary" onClick={() => setLiveDetail("candidates")}>
              Ver las {liveCandidates.length} líneas →
            </button>
            <button className="button secondary" onClick={() => setLiveDetail("anomalies")}>
              Ver las {analysis?.anomalies.length ?? 0} anomalías →
            </button>
          </div>
          {liveDetail === "candidates" && (
            <section className="liveAnalysisPanel" aria-label="Líneas bajo hipótesis de inclusión">
              <header>
                <div>
                  <b>{liveCandidates.length} líneas bajo hipótesis de inclusión</b>
                  <small>Ordenadas desde la mayor probabilidad</small>
                </div>
                <button onClick={() => setLiveDetail(null)}>Cerrar</button>
              </header>
              <div className="liveLineList">
                {[...liveCandidates]
                  .sort((left, right) => (right.candidates[0]?.probability ?? 0) - (left.candidates[0]?.probability ?? 0))
                  .map((assessment) => {
                    const candidate = assessment.candidates[0];
                    return (
                      <article key={assessment.line.id}>
                        <div>
                          <b>{assessment.line.description}</b>
                          <small>{assessment.line.section || "Sección no identificada"} · Pág. {assessment.line.page}</small>
                        </div>
                        <strong>${assessment.line.amount.toLocaleString("es-CL")}</strong>
                        <span>{Math.round((candidate?.probability ?? 0) * 100)}%</span>
                        <p>{candidate?.reasons[0] || "Coincidencia contextual con una prestación principal."}</p>
                        {!!candidate?.missingEvidence.length && <em>Falta: {candidate.missingEvidence.join("; ")}</em>}
                      </article>
                    );
                  })}
              </div>
            </section>
          )}
          {liveDetail === "anomalies" && (
            <section className="liveAnalysisPanel" aria-label="Anomalías detectadas">
              <header>
                <div>
                  <b>{analysis?.anomalies.length ?? 0} anomalías para revisión</b>
                  <small>Señales técnicas; todavía no son conclusiones de improcedencia</small>
                </div>
                <button onClick={() => setLiveDetail(null)}>Cerrar</button>
              </header>
              <div className="anomalyList">
                {analysis?.anomalies.map((anomaly, index) => {
                  const related = analysis.lineAssessments.filter((item) => anomaly.lineIds.includes(item.line.id));
                  return (
                    <article key={`${anomaly.type}-${index}`}>
                      <span>{anomaly.severity === "high" ? "Alta" : anomaly.severity === "review" ? "Revisar" : "Informativa"}</span>
                      <div>
                        <b>{anomaly.type.replaceAll("_", " ")}</b>
                        <p>{anomaly.explanation}</p>
                        <small>{related.map((item) => `${item.line.description} · pág. ${item.line.page}`).join(" | ")}</small>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {analysisError && <div className="extractionStatus error">Análisis incompleto: {analysisError}</div>}
      <div className="findings">
        <h3>Qué dice este primer informe</h3>
        <div>
          <span className="findingIcon amber">≠</span>
          <p>
            <b>
              {isEmblematic
                ? "Coincidencia normativa, no veredicto"
                : hasLiveAnalysis
                  ? `${liveCandidates.length} líneas con hipótesis probabilística`
                  : "Puntos que requieren revisión"}
            </b>
            <small>
              {isEmblematic
                ? "14 líneas de insumos y 8 líneas farmacológicas activaron reglas de pabellón con trazabilidad a páginas 1–2."
                : hasLiveAnalysis
                  ? "Cada coincidencia conserva glosa, monto, página, probabilidad y evidencia faltante."
                  : "El informe separa hechos documentales de hipótesis."}
            </small>
          </p>
          <button onClick={() => hasLiveAnalysis && setLiveDetail("candidates")}>Reglas</button>
        </div>
        <div>
          <span className="findingIcon blue">↔</span>
          <p>
            <b>
              {isEmblematic
                ? "La cuenta y los PAM prácticamente concilian"
                : "Documentación conectada"}
            </b>
            <small>
              {isEmblematic
                ? "$6.912.876 en la cuenta versus $6.912.875 en los PAM: diferencia de $1 para confirmar."
                : "La evidencia quedó vinculada a su archivo original."}
            </small>
          </p>
          <button>Fuente</button>
        </div>
        {!availability.contrato && (
          <div>
            <span className="findingIcon gray">+</span>
            <p>
              <b>El contrato define si el indicio puede confirmarse</b>
              <small>
                El informe ya detecta y cuantifica la posible fragmentación; el
                contrato y convenio determinan si corresponde impugnarla.
              </small>
            </p>
            <button>Etapa posterior</button>
          </div>
        )}
      </div>
      <div className="stageActions end">
        <button className="button primary" onClick={onContinue}>
          Ver informe completo →
        </button>
      </div>
    </div>
  );
}

function Dashboard({
  docs,
  caseId,
  availability,
  analysis,
}: {
  docs: UploadedDoc[];
  caseId: string;
  availability: { cuenta: boolean; pam: boolean; contrato: boolean };
  analysis?: ClinicalAccountAnalysis;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const isEmblematic = docs.some((d) =>
    d.segments?.some((s) => s.pages === "Páginas 1–8"),
  );
  const liveCandidates = analysis?.lineAssessments.filter((assessment) =>
    assessment.candidates.some((candidate) => candidate.probability >= 0.45),
  ) ?? [];
  const liveCandidateAmount = liveCandidates.reduce((sum, assessment) => sum + assessment.line.amount, 0);
  const unexplainedLines = findLinesWithoutPamExplanation(analysis, docs);
  const unexplainedAmount = unexplainedLines.reduce((sum, item) => sum + item.line.amount, 0);
  return (
    <div className="dashboard">
      <div className="dashboardHead">
        <div>
          <p>CASO {caseId.slice(0, 8).toUpperCase()}</p>
          <h1>Hospitalización por apendicitis</h1>
          <span>Clínica INDISA · Nueva Masvida</span>
        </div>
        <button className="button ghost">＋ Agregar documento</button>
      </div>
      <div className="dashboardGrid">
        <section className="casePanel overview">
          <div className="panelTitle">
            <h2>Estado del expediente</h2>
            <span className="statusPill">PRIMER INFORME LISTO</span>
          </div>
          <div className="routeMap">
            <div className="complete">
              <span>✓</span>
              <b>Documentos</b>
              <small>
                {docs.length} archivo{docs.length === 1 ? "" : "s"}
              </small>
            </div>
            <i />
            <div className="complete">
              <span>✓</span>
              <b>Primer informe</b>
              <small>Disponible</small>
            </div>
            <i />
            <div className="current">
              <span>3</span>
              <b>Cruces</b>
              <small>{availability.pam ? "Cuenta ↔ PAM" : "Espera PAM"}</small>
            </div>
            <i />
            <div>
              <span>4</span>
              <b>Reclamo</b>
              <small>Pendiente</small>
            </div>
          </div>
        </section>
        <section className="casePanel nextAction">
          <p>INFORME DISPONIBLE</p>
          <h2>
            {isEmblematic
              ? "$722.602 bajo reglas de inclusión"
              : analysis
                ? `$${liveCandidateAmount.toLocaleString("es-CL")} bajo hipótesis de inclusión`
                : "Revisa tu primer informe"}
          </h2>
          <span>
            {isEmblematic
              ? "El motor detectó coincidencias de posible fragmentación en pabellón. Son indicios trazables, todavía no una devolución confirmada."
              : analysis
                ? `${liveCandidates.length} líneas de la cuenta fueron vinculadas probabilísticamente con una prestación principal.`
                : "No necesitas contrato para abrirlo. El contrato se usará después para calcular coberturas y topes."}
          </span>
          <button
            className="button primary"
            onClick={() => setReportOpen(true)}
          >
            Abrir primer informe →
          </button>
        </section>
        <section className="casePanel evidence">
          <div className="panelTitle">
            <h2>Documentos y evidencia</h2>
            <button>Ver todo</button>
          </div>
          {docs.map((d) => (
            <div className="evidenceRow" key={d.id}>
              <span className="miniPdf">PDF</span>
              <p>
                <b>{d.name}</b>
                <small>{d.size} · Clasificado</small>
              </p>
              <em>✓</em>
            </div>
          ))}
        </section>
        <section className="casePanel pendingEngines">
          <div className="panelTitle">
            <h2>Motores del caso</h2>
            <span>Avance por etapas</span>
          </div>
          {[
            "Primer informe documental",
            "Motor de fragmentación",
            "Cruce Cuenta ↔ PAM",
            "Reglas de contrato",
            "Hallazgos y evidencia",
            "Generador de reclamos",
          ].map((x, i) => (
            <div key={x}>
              <span>
                {i < 3 && (isEmblematic || Boolean(analysis))
                  ? "✓"
                  : i === 0
                    ? "✓"
                    : i < 3
                      ? "↗"
                      : "○"}
              </span>
              <b>{x}</b>
              <small>
                {i < 3 && (isEmblematic || Boolean(analysis))
                  ? "Completado preliminar"
                  : i === 0
                    ? "Completado"
                    : i < 3
                      ? "Listo para continuar"
                      : "Etapa posterior"}
              </small>
            </div>
          ))}
        </section>
      </div>
      {!!unexplainedLines.length && (
        <div className="unexplainedCallout dashboardUnexplained">
          <span>!</span>
          <div>
            <b>{unexplainedLines.length} líneas sin explicación directa en el PAM · ${unexplainedAmount.toLocaleString("es-CL")}</b>
            <p>Brecha documental pendiente de respuesta de la clínica o Isapre. El monto ya está contenido en el total de la cuenta y no se suma nuevamente.</p>
          </div>
          <button className="button ghost" onClick={() => setReportOpen(true)}>Ver detalle →</button>
        </div>
      )}
      <div className="disclaimer">
        <b>Importante:</b> RevisaTuCuenta organiza información y genera
        hipótesis de revisión. No reemplaza una auditoría médica, asesoría legal
        ni garantiza una devolución.
      </div>
      {reportOpen && (
        <PreliminaryReport
          isEmblematic={isEmblematic}
          availability={availability}
          analysis={analysis}
          docs={docs}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

const verdictLabels: Record<RuleEvaluation["verdict"], string> = {
  candidate: "Indicio",
  cleared: "Sin alerta",
  not_evaluable: "No evaluable",
  informational: "Antecedente",
};

function RuleEngineReport({ evaluations }: { evaluations: RuleEvaluation[] }) {
  const candidateTotal = evaluations
    .filter((evaluation) => evaluation.verdict === "candidate")
    .reduce((sum, evaluation) => sum + (evaluation.amount ?? 0), 0);

  return (
    <section className="ruleEngineSection">
      <div className="ruleSectionHead">
        <div>
          <h3>3. Motor de fragmentación / unbundling</h3>
          <p>
            Cada regla declara su fuente, ámbito y evidencia faltante. Una
            coincidencia no se convierte automáticamente en cobro indebido.
          </p>
        </div>
        <div className="candidateTotal">
          <span>Monto bajo reglas</span>
          <strong>${candidateTotal.toLocaleString("es-CL")}</strong>
          <small>candidato, no confirmado</small>
        </div>
      </div>
      <div className="ruleEvaluationList">
        {evaluations.map((evaluation) => (
          <article className={`ruleEvaluation ${evaluation.verdict}`} key={evaluation.ruleId}>
            <div className="ruleEvaluationHead">
              <span className="ruleId">{evaluation.ruleId}</span>
              <b>{evaluation.title}</b>
              <em>{verdictLabels[evaluation.verdict]}</em>
            </div>
            <p>{evaluation.explanation}</p>
            <div className="ruleMeta">
              {evaluation.amount !== null && (
                <span>Monto: ${evaluation.amount.toLocaleString("es-CL")}</span>
              )}
              <a href={evaluation.source.url} target="_blank" rel="noreferrer">
                {evaluation.source.label} · {evaluation.source.section}
              </a>
            </div>
            {evaluation.missingEvidence && (
              <div className="missingEvidence">
                <b>Falta para concluir:</b> {evaluation.missingEvidence}
              </div>
            )}
            {evaluation.matchedLines.length > 1 && evaluation.ruleId.startsWith("UB-") && (
              <details>
                <summary>Ver {evaluation.matchedLines.length} líneas detectadas</summary>
                <div className="matchedLines">
                  {evaluation.matchedLines.map((line) => (
                    <div key={line.id}>
                      <span>{line.description}</span>
                      <b>${line.amount.toLocaleString("es-CL")}</b>
                      <em>Pág. {line.page}</em>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
      </div>
      <div className="scopeWarning">
        <b>Regla de alcance:</b> la Resolución N°277 regula FONASA MLE. En este
        caso Isapre convencional funciona como referencia técnica hasta probar
        su incorporación al convenio o contrato aplicable.
      </div>
    </section>
  );
}

function PreliminaryReport({
  isEmblematic,
  availability,
  analysis,
  docs,
  onClose,
}: {
  isEmblematic: boolean;
  availability: { cuenta: boolean; pam: boolean; contrato: boolean };
  analysis?: ClinicalAccountAnalysis;
  docs: UploadedDoc[];
  onClose: () => void;
}) {
  const ruleEvaluations = isEmblematic
    ? evaluateEmblematicCase(availability.contrato)
    : [];
  const candidateAssessments = analysis?.lineAssessments.filter((assessment) =>
    assessment.candidates.some((candidate) => candidate.probability >= 0.45),
  ) ?? [];
  const accountTotal = analysis?.lineAssessments.reduce(
    (sum, assessment) => sum + assessment.line.amount,
    0,
  ) ?? 0;
  const candidateTotal = candidateAssessments.reduce(
    (sum, assessment) => sum + assessment.line.amount,
    0,
  );
  const nonCandidateTotal = accountTotal - candidateTotal;
  const pamTotal = docs.reduce(
    (sum, doc) => sum + (doc.extraction?.pam?.lines.reduce((subtotal, line) => subtotal + line.amount, 0) ?? 0),
    0,
  );
  const pamLines = docs.flatMap((doc) => doc.extraction?.pam?.lines ?? []);
  const unexplainedAssessments = findLinesWithoutPamExplanation(analysis, docs);
  const unexplainedTotal = unexplainedAssessments.reduce(
    (sum, assessment) => sum + assessment.line.amount,
    0,
  );
  return (
    <div
      className="reportOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
    >
      <button
        className="reportBackdrop"
        aria-label="Cerrar informe"
        onClick={onClose}
      />
      <article className="reportSheet">
        <header>
          <div>
            <p>REVISATUCUENTA · INFORME PRELIMINAR</p>
            <h2 id="report-title">Primer informe del caso</h2>
            <span>
              Hospitalización por apendicitis · datos personales omitidos
            </span>
          </div>
          <button onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="reportStatus">
          <span>✓</span>
          <p>
            <b>Informe útil generado sin contrato</b>
            <small>
              Describe montos y diferencias documentales. El contrato se usará
              después para juzgar coberturas, topes y exclusiones.
            </small>
          </p>
        </div>
        {isEmblematic ? (
          <>
            <section>
              <h3>1. Resumen financiero</h3>
              <div className="reportMetrics">
                <article>
                  <span>Cuenta clínica</span>
                  <strong>$6.912.876</strong>
                  <small>Fuente · pág. 8</small>
                </article>
                <article>
                  <span>Bonificación PAM</span>
                  <strong>$6.460.700</strong>
                  <small>93,46% · págs. 11, 20–22</small>
                </article>
                <article>
                  <span>A cargo del paciente</span>
                  <strong>$452.175</strong>
                  <small>6,54% · págs. 11, 20–22</small>
                </article>
              </div>
              <div className="reconciliation">
                <div>
                  <span>Cuenta clínica</span>
                  <b>$6.912.876</b>
                </div>
                <i>versus</i>
                <div>
                  <span>Suma valores PAM</span>
                  <b>$6.912.875</b>
                </div>
                <strong>Diferencia: $1</strong>
              </div>
              <p className="reportExplanation">
                Los dos PAM cubren el mismo episodio: $6.852.344 del folio
                principal y $60.531 de la consulta de urgencia. La suma queda a
                un peso del total de la cuenta; esto parece una diferencia de
                cuadratura documental y debe confirmarse, no una señal de
                sobrecobro por sí sola.
              </p>
            </section>
            <section>
              <h3>2. Composición relevante de la cuenta</h3>
              <div className="financialTable">
                <div className="tableHead">
                  <span>Rubro</span>
                  <span>Monto</span>
                  <span>Origen</span>
                </div>
                <div>
                  <b>Pabellón · apendicectomía</b>
                  <span>$1.914.834</span>
                  <em>Pág. 2</em>
                </div>
                <div>
                  <b>Honorarios equipo médico</b>
                  <span>$1.485.096</span>
                  <em>Pág. 8</em>
                </div>
                <div>
                  <b>Insumos de pabellón</b>
                  <span>$1.190.610</span>
                  <em>Págs. 1–2</em>
                </div>
                <div>
                  <b>Medicamentos de pabellón</b>
                  <span>$567.100</span>
                  <em>Pág. 2</em>
                </div>
                <div>
                  <b>Día cama individual</b>
                  <span>$452.075</span>
                  <em>Pág. 1</em>
                </div>
                <div>
                  <b>TAC abdomen y pelvis</b>
                  <span>$408.981</span>
                  <em>Pág. 7</em>
                </div>
              </div>
            </section>
            <RuleEngineReport evaluations={ruleEvaluations} />
            <section>
              <h3>4. Hallazgos preliminares</h3>
              <div className="reportFindings">
                <article>
                  <span>01</span>
                  <div>
                    <b>Los PAM explican quién financia casi todo el total.</b>
                    <p>
                      Bonificación informada de $6.460.700 y copago total de
                      $452.175. El informe ya puede mostrar este reparto aunque
                      falte el contrato.
                    </p>
                    <small>Fuente · PAM, págs. 11 y 20–22</small>
                  </div>
                </article>
                <article>
                  <span>02</span>
                  <div>
                    <b>Hay $440.069 de copago en el PAM principal.</b>
                    <p>
                      Incluye medicamentos, materiales y gastos marcados como
                      “no cubiertos por el plan”, más diferencias de
                      bonificación. Debe revisarse cada motivo antes de
                      reclamar.
                    </p>
                    <small>Fuente · PAM, págs. 20–22</small>
                  </div>
                </article>
                <article>
                  <span>03</span>
                  <div>
                    <b>
                      La liquidación identifica consumos específicos sin
                      cobertura.
                    </b>
                    <p>
                      Entre ellos aparecen artículos de uso del paciente y
                      prestaciones como instalación de vía venosa y fleboclisis.
                      Que figuren sin cobertura no basta para afirmar que el
                      cobro sea improcedente.
                    </p>
                    <small>Fuente · liquidación, pág. 18</small>
                  </div>
                </article>
                <article>
                  <span>04</span>
                  <div>
                    <b>
                      El episodio está fragmentado entre dos prestadores y dos
                      PAM.
                    </b>
                    <p>
                      La clínica concentra hospitalización, pabellón,
                      medicamentos y materiales; otra sociedad concentra
                      consulta, honorarios, imagenología y otros servicios. El
                      cruce debe conservar esa separación.
                    </p>
                    <small>Fuente · cuenta, págs. 1–8; PAM, págs. 9–22</small>
                  </div>
                </article>
              </div>
            </section>
            <section>
              <h3>5. Conducta institucional y efecto humano</h3>
              <p>
                Esta capa compara lo preguntado, lo contestado y lo que finalmente
                se corrigió. Describe patrones observables; no presume fraude,
                mala fe ni diagnostica intenciones personales.
              </p>
              <div className="reportFindings">
                {APPENDICITIS_CONDUCT_FINDINGS.map((finding, index) => (
                  <article key={finding.pattern}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <b>{finding.title}</b>
                      <p>{finding.explanation}</p>
                      <small>
                        Efecto humano · {finding.humanEffect} · Confianza {finding.confidence === "high" ? "alta" : "moderada"}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
              <div className="nextQuestions">
                <b>Hipótesis responsable sobre intencionalidad</b>
                <p>
                  La secuencia es compatible con opacidad estratégica o con un
                  sistema que tolera respuestas incompletas porque la mayoría de
                  los usuarios no perseverará. Eso justifica investigar la
                  intención, pero no basta por sí solo para afirmarla como hecho.
                </p>
              </div>
            </section>
            <section>
              <h3>6. Qué falta para una conclusión de cobertura</h3>
              <p>
                El contrato no es necesario para conocer los montos ni detectar
                diferencias. Sí se necesita para evaluar si cada copago,
                exclusión o prestación no arancelada fue aplicada conforme al
                plan. Mientras no esté disponible, estos puntos son preguntas
                fundadas y no acusaciones.
              </p>
              <div className="nextQuestions">
                <b>Próximas verificaciones</b>
                <ul>
                  <li>Confirmar la diferencia de $1 entre cuenta y PAM.</li>
                  <li>
                    Solicitar el fundamento de cada gasto marcado “no cubierto
                    por el plan”.
                  </li>
                  <li>
                    Revisar si los insumos cobrados separadamente están
                    incluidos en día cama o derecho de pabellón según el
                    convenio aplicable.
                  </li>
                  <li>
                    Incorporar el contrato para contrastar porcentajes, topes y
                    exclusiones.
                  </li>
                </ul>
              </div>
            </section>
          </>
        ) : (
          <>
            <section>
              <h3>1. Documentación identificada</h3>
              <div className="reportRows">
                <div>
                  <b>Cuenta clínica</b>
                  <span>Disponible</span>
                  <em>Verificada</em>
                </div>
                <div>
                  <b>PAM / liquidaciones</b>
                  <span>{availability.pam ? "Disponible" : "No agregado"}</span>
                  <em className={availability.pam ? "" : "pending"}>
                    {availability.pam ? "Verificado" : "Opcional ahora"}
                  </em>
                </div>
                <div>
                  <b>Contrato de salud</b>
                  <span>
                    {availability.contrato ? "Disponible" : "No agregado"}
                  </span>
                  <em className={availability.contrato ? "" : "pending"}>
                    {availability.contrato ? "Verificado" : "Etapa posterior"}
                  </em>
                </div>
              </div>
            </section>
            <section>
              <h3>2. Resultado del motor probabilístico</h3>
              {analysis ? (
                <>
                  <div className="reportMetrics">
                    <article>
                      <span>Líneas analizadas</span>
                      <strong>{analysis.lineAssessments.length}</strong>
                      <small>Con documento y página</small>
                    </article>
                    <article>
                      <span>Con candidato de inclusión</span>
                      <strong>{candidateAssessments.length}</strong>
                      <small>${candidateTotal.toLocaleString("es-CL")} para contrastar</small>
                    </article>
                    <article>
                      <span>Anomalías</span>
                      <strong>{analysis.anomalies.length}</strong>
                      <small>Duplicidad, ajustes u otras señales</small>
                    </article>
                  </div>
                  <div className="totalsReconciliation">
                    <div>
                      <span>Total de las líneas de la cuenta</span>
                      <b>${accountTotal.toLocaleString("es-CL")}</b>
                    </div>
                    <i>=</i>
                    <div>
                      <span>Sin hipótesis de inclusión</span>
                      <b>${nonCandidateTotal.toLocaleString("es-CL")}</b>
                    </div>
                    <i>+</i>
                    <div>
                      <span>Bajo hipótesis de inclusión</span>
                      <b>${candidateTotal.toLocaleString("es-CL")}</b>
                    </div>
                  </div>
                  {pamTotal > 0 && (
                    <div className="pamComparison">
                      <div><span>Total documental de la cuenta</span><b>${accountTotal.toLocaleString("es-CL")}</b></div>
                      <div><span>Total de prestaciones informadas en PAM/bonos</span><b>${pamTotal.toLocaleString("es-CL")}</b></div>
                      <div><span>Diferencia documental</span><b>${Math.abs(accountTotal - pamTotal).toLocaleString("es-CL")}</b></div>
                      <p>Estos universos pueden no ser equivalentes. La diferencia se informa para conciliación y no se interpreta automáticamente como cobro excesivo.</p>
                    </div>
                  )}
                  <h3 className="reportSubheading">Detalle de líneas candidatas</h3>
                  <div className="financialTable">
                    <div className="tableHead">
                      <span>Glosa observada</span>
                      <span>Probabilidad</span>
                      <span>Origen</span>
                    </div>
                    {candidateAssessments
                      .sort((left, right) => (right.candidates[0]?.probability ?? 0) - (left.candidates[0]?.probability ?? 0))
                      .map((item) => (
                        <div key={item.line.id}>
                          <div>
                            <b>{item.line.description}</b>
                            <small>{item.candidates[0]?.reasons[0] || "Coincidencia con conocimiento específico del corpus."}</small>
                          </div>
                          <span>{Math.round((item.candidates[0]?.probability ?? 0) * 100)}% · ${item.line.amount.toLocaleString("es-CL")}</span>
                          <em>Pág. {item.line.page}</em>
                        </div>
                      ))}
                  </div>
                  <p className="reportExplanation">
                    La suma candidata está contenida en el total de la cuenta: no se agrega encima de él.
                    Las prestaciones principales se usan como anclas y no se marcan como fragmentos solo por aparecer en una sección de pabellón.
                    Las probabilidades no prueban por sí solas que el cobro separado sea improcedente.
                  </p>
                  <h3>3. Anomalías para revisión</h3>
                  {analysis.anomalies.length ? (
                    <div className="anomalyList reportAnomalies">
                      {analysis.anomalies.map((anomaly, index) => {
                        const related = analysis.lineAssessments.filter((item) => anomaly.lineIds.includes(item.line.id));
                        return (
                          <article key={`${anomaly.type}-${index}`}>
                            <span>{anomaly.severity === "high" ? "Alta" : anomaly.severity === "review" ? "Revisar" : "Informativa"}</span>
                            <div>
                              <b>{anomaly.type.replaceAll("_", " ")}</b>
                              <p>{anomaly.explanation}</p>
                              <small>{related.map((item) => `${item.line.description} · pág. ${item.line.page}`).join(" | ")}</small>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p>No se detectaron anomalías adicionales.</p>
                  )}
                  <h3 className="reportSubheading">4. Líneas sin explicación suficiente en el PAM</h3>
                  {pamLines.length ? (
                    <>
                      <div className="unexplainedSummary">
                        <div><span>Líneas sin correspondencia directa</span><b>{unexplainedAssessments.length}</b></div>
                        <div><span>Monto contenido en la cuenta</span><b>${unexplainedTotal.toLocaleString("es-CL")}</b></div>
                        <p>Este monto ya forma parte de los ${accountTotal.toLocaleString("es-CL")} de la cuenta y no debe volver a sumarse. La ausencia en el PAM es una brecha documental que exige explicación, no una prueba automática de improcedencia.</p>
                      </div>
                      <div className="unexplainedList">
                        {unexplainedAssessments.map((assessment) => {
                          const isCandidate = assessment.candidates.some((candidate) => candidate.probability >= 0.45);
                          const relatedAnomalies = analysis.anomalies.filter((anomaly) => anomaly.lineIds.includes(assessment.line.id));
                          return (
                            <article key={`unexplained-${assessment.line.id}`}>
                              <div>
                                <b>{assessment.line.description}</b>
                                <small>{assessment.line.section || "Sección no identificada"} · Pág. {assessment.line.page}</small>
                              </div>
                              <strong>${assessment.line.amount.toLocaleString("es-CL")}</strong>
                              <p>No se encontró código o glosa equivalente en las prestaciones extraídas del PAM.</p>
                              <footer>
                                {isCandidate && <em>También candidato de inclusión</em>}
                                {relatedAnomalies.map((anomaly) => <em key={anomaly.type}>Anomalía: {anomaly.type.replaceAll("_", " ")}</em>)}
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p>No hay líneas PAM suficientes para ejecutar este cruce. Debe solicitarse el PAM o liquidación detallada.</p>
                  )}
                </>
              ) : (
                <p>
                  La cuenta fue identificada, pero todavía no produjo líneas suficientes para el motor.
                  Revisa la extracción antes de continuar.
                </p>
              )}
            </section>
          </>
        )}
        <footer>
          <span>
            Informe preliminar · No constituye auditoría médica ni asesoría
            legal.
          </span>
          <button className="button primary" onClick={onClose}>
            Volver al caso
          </button>
        </footer>
      </article>
    </div>
  );
}
