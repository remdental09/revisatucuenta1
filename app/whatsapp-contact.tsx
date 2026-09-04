"use client";

import { useState, type MouseEvent } from "react";

const WHATSAPP_NUMBER = "56996963089";
const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`;
const QUESTION_PROMPTS = [
  "1. ¿El prestador o la clínica te envió la cuenta de hospitalización detallada y no sólo el total? Responde: Sí / No.",
  "2. ¿Tienes el PAM de tu Isapre? Responde: Sí / No.",
];

export function WhatsAppContact() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [need, setNeed] = useState("Necesito orientación para revisar mi cuenta de hospitalización y mi PAM.");
  const [error, setError] = useState("");

  const message = [
    `Hola, soy ${name.trim()}.`,
    need.trim(),
    "",
    "Para continuar, responderé estas preguntas:",
    ...QUESTION_PROMPTS,
    "",
    "Mis respuestas: 1) ___  2) ___.",
  ].join("\n");
  const whatsappHref = `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`;

  function handleOpenWhatsApp(event: MouseEvent<HTMLAnchorElement>) {
    if (name.trim().length < 2) {
      event.preventDefault();
      setError("Escribe tu nombre para que podamos identificar tu solicitud.");
    }
  }

  function handleNameChange(value: string) {
    setName(value);
    if (error) setError("");
  }

  return (
    <div className={`whatsapp-widget${open ? " is-open" : ""}`}>
      {open && (
        <section id="whatsapp-card" className="whatsapp-card" aria-labelledby="whatsapp-card-title">
          <div className="whatsapp-card-header">
            <div>
              <p className="whatsapp-kicker">Contacto directo</p>
              <h2 id="whatsapp-card-title">¿Necesitas ayuda?</h2>
            </div>
            <button className="whatsapp-close" type="button" aria-label="Cerrar contacto por WhatsApp" onClick={() => setOpen(false)}>×</button>
          </div>
          <p className="whatsapp-card-copy">Al abrir WhatsApp verás dos preguntas para responder con Sí o No.</p>
          <label className="whatsapp-field">
            Tu nombre
            <input type="text" autoComplete="name" placeholder="Ej. María Rodríguez" value={name} onChange={(event) => handleNameChange(event.target.value)} />
          </label>
          <label className="whatsapp-field">
            ¿Qué necesitas revisar?
            <textarea value={need} onChange={(event) => setNeed(event.target.value)} rows={3} />
          </label>
          <div className="whatsapp-question-preview" aria-label="Preguntas que se prepararán en WhatsApp">
            <p>{QUESTION_PROMPTS[0]}</p>
            <p>{QUESTION_PROMPTS[1]}</p>
          </div>
          <p className="whatsapp-privacy-note">No envíes tu RUN ni documentos por WhatsApp. Súbelos sólo en el acceso seguro.</p>
          {error && <p className="whatsapp-error" role="alert">{error}</p>}
          <a className="whatsapp-submit" href={whatsappHref} target="_blank" rel="noreferrer" onClick={handleOpenWhatsApp}>
            Abrir WhatsApp <span aria-hidden="true">↗</span>
          </a>
        </section>
      )}
      <button className="whatsapp-launcher" type="button" aria-expanded={open} aria-controls="whatsapp-card" onClick={() => setOpen((value) => !value)}>
        <span className="whatsapp-mark" aria-hidden="true">◔</span>
        {open ? "Cerrar" : "Habla con nosotros"}
      </button>
    </div>
  );
}
