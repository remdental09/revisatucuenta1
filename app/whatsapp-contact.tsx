"use client";

import { useState } from "react";

const WHATSAPP_NUMBER = "56996963089";
const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

export function WhatsAppContact() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [need, setNeed] = useState("Necesito orientación para revisar mi cuenta de hospitalización y mi PAM.");
  const [error, setError] = useState("");

  const message = `Hola, soy ${name.trim()}. ${need.trim()}`;
  const whatsappHref = `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`;

  function handleOpenWhatsApp(event: React.MouseEvent<HTMLAnchorElement>) {
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
          <p className="whatsapp-card-copy">Déjanos tu nombre y te conectamos con nuestro WhatsApp de atención.</p>
          <label className="whatsapp-field">
            Tu nombre
            <input type="text" autoComplete="name" placeholder="Ej. María Rodríguez" value={name} onChange={(event) => handleNameChange(event.target.value)} />
          </label>
          <label className="whatsapp-field">
            ¿Qué necesitas revisar?
            <textarea value={need} onChange={(event) => setNeed(event.target.value)} rows={3} />
          </label>
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
