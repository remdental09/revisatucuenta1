"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const WHATSAPP_NUMBER = "56996963089";
const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`;
const PATIENT_UPLOAD_URL = "https://revisatucuenta.cl/?view=patient";

type Message = { id: number; role: "bot" | "patient"; text: string };
type QuickAction = { label: string; action: string };
type PendingQuestion = "detailed" | "pam" | "none";
type Answers = { detailed?: "Sí" | "No"; pam?: "Sí" | "No" };

const INITIAL_MESSAGE: Message = {
  id: 1,
  role: "bot",
  text: "Hola. Soy el asistente de RevisaTuCuenta. Puedo orientarte sobre tu cuenta de hospitalización, el PAM y el resultado preliminar. ¿Qué necesitas?",
};

const INITIAL_ACTIONS: QuickAction[] = [
  { label: "Quiero subir mi cuenta", action: "upload" },
  { label: "Tengo preguntas sobre el PAM", action: "pam_info" },
  { label: "Quiero entender un resultado", action: "result" },
  { label: "Necesito hablar con un humano", action: "human" },
];

const DETAILED_QUESTION = "¿El prestador o la clínica te envió la cuenta de hospitalización detallada y no sólo el total?";
const PAM_QUESTION = "¿Tienes el PAM de tu Isapre?";

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isYes(value: string) {
  return /^(si|s|yes|claro|tengo|afirmativo)/.test(normalizeText(value).trim());
}

function isNo(value: string) {
  return /^(no|nunca|aun no|todavia no)/.test(normalizeText(value).trim());
}

export function SupportChatbox() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [quickActions, setQuickActions] = useState<QuickAction[]>(INITIAL_ACTIONS);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion>("none");
  const [answers, setAnswers] = useState<Answers>({});
  const [humanRequested, setHumanRequested] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const messageId = useRef(2);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const whatsappHref = useMemo(() => {
    const context = [
      "Hola, necesito hablar con un humano en RevisaTuCuenta.",
      answers.detailed ? `Cuenta detallada: ${answers.detailed}.` : "",
      answers.pam ? `PAM de Isapre: ${answers.pam}.` : "",
      "No enviaré RUN ni documentos por este medio.",
    ].filter(Boolean).join("\n");
    return `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(context)}`;
  }, [answers]);

  function nextId() {
    const id = messageId.current;
    messageId.current += 1;
    return id;
  }

  function appendConversation(patientText: string, botText: string, actions: QuickAction[], pending: PendingQuestion = "none") {
    setMessages((current) => [
      ...current,
      { id: nextId(), role: "patient", text: patientText },
      { id: nextId(), role: "bot", text: botText },
    ]);
    setQuickActions(actions);
    setPendingQuestion(pending);
  }

  function resetChat() {
    setMessages([{ ...INITIAL_MESSAGE, id: nextId() }]);
    setQuickActions(INITIAL_ACTIONS);
    setPendingQuestion("none");
    setAnswers({});
    setHumanRequested(false);
    setDraft("");
  }

  function askDetailed(patientText = "Quiero subir mi cuenta") {
    setHumanRequested(false);
    appendConversation(patientText, `${DETAILED_QUESTION} Responde Sí o No.`, [
      { label: "Sí", action: "detailed_yes" },
      { label: "No", action: "detailed_no" },
      { label: "Hablar con un humano", action: "human" },
    ], "detailed");
  }

  function askPam(patientText: string) {
    appendConversation(patientText, `${PAM_QUESTION} Responde Sí o No.`, [
      { label: "Sí", action: "pam_yes" },
      { label: "No", action: "pam_no" },
      { label: "Hablar con un humano", action: "human" },
    ], "pam");
  }

  function requestHuman(patientText = "Necesito hablar con un humano") {
    setHumanRequested(true);
    appendConversation(
      patientText,
      "De acuerdo. Puedes continuar con una persona por WhatsApp. El enlace llevará sólo tus respuestas de orientación; no envíes RUN ni documentos por ese canal.",
      [{ label: "Volver al inicio", action: "reset" }],
    );
  }

  function handleAction(action: string, label: string) {
    if (action === "reset") return resetChat();
    if (action === "human") return requestHuman(label);
    if (action === "upload") return askDetailed(label);
    if (action === "detailed_yes") {
      setAnswers((current) => ({ ...current, detailed: "Sí" }));
      return askPam(label);
    }
    if (action === "detailed_no") {
      setAnswers((current) => ({ ...current, detailed: "No" }));
      return appendConversation(label, "Solicita al prestador o la clínica la cuenta completa, con el detalle de cargos y prestaciones. Con sólo el total no podemos revisar cada línea.", [
        { label: "Ya conseguí la cuenta detallada", action: "detailed_ready" },
        { label: "Hablar con un humano", action: "human" },
      ]);
    }
    if (action === "detailed_ready") return askPam(label);
    if (action === "pam_info") {
      return appendConversation(label, "El PAM es el Programa de Atención Médica de tu Isapre. Allí aparecen las prestaciones, coberturas y condiciones de la atención.", [
        { label: "Sí, tengo el PAM", action: "pam_yes" },
        { label: "No tengo el PAM", action: "pam_no" },
        { label: "Volver al inicio", action: "reset" },
      ]);
    }
    if (action === "pam_yes") {
      setAnswers((current) => ({ ...current, pam: "Sí" }));
      return appendConversation(label, "Perfecto. Puedes cargar la cuenta detallada y el PAM desde el acceso seguro para iniciar una lectura preliminar.", [
        { label: "Subir mi cuenta", action: "upload_link" },
        { label: "Entender un resultado", action: "result" },
        { label: "Hablar con un humano", action: "human" },
      ]);
    }
    if (action === "pam_no") {
      setAnswers((current) => ({ ...current, pam: "No" }));
      return appendConversation(label, "Puedes comenzar con la cuenta detallada. El análisis de coberturas quedará incompleto hasta que agregues el PAM.", [
        { label: "Subir mi cuenta", action: "upload_link" },
        { label: "Hablar con un humano", action: "human" },
      ]);
    }
    if (action === "upload_link") {
      return appendConversation(label, "Te llevaré al acceso seguro para pacientes. No cargues documentos ni RUN en este chat.", [
        { label: "Volver al inicio", action: "reset" },
        { label: "Hablar con un humano", action: "human" },
      ]);
    }
    if (action === "result") {
      return appendConversation(label, "El resultado es preliminar. Muestra cargos o coberturas que conviene revisar; no declara por sí solo un cobro ilegal ni garantiza una devolución.", [
        { label: "Quiero subir mi cuenta", action: "upload" },
        { label: "Hablar con un humano", action: "human" },
        { label: "Volver al inicio", action: "reset" },
      ]);
    }
  }

  async function requestAiAnswer(text: string) {
    const placeholderId = nextId();
    const history = [
      ...messages.map((message) => ({
        role: message.role === "patient" ? "user" as const : "assistant" as const,
        content: message.text,
      })),
      { role: "user" as const, content: text },
    ].slice(-12);
    setMessages((current) => [
      ...current,
      { id: nextId(), role: "patient", text },
      { id: placeholderId, role: "bot", text: "Estoy revisando tu pregunta…" },
    ]);
    setQuickActions([]);
    setAiLoading(true);
    try {
      const response = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const payload = await response.json() as { message?: unknown; escalate?: unknown; error?: unknown };
      if (!response.ok || typeof payload.message !== "string") throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo responder.");
      setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, text: payload.message as string } : message));
      if (payload.escalate === true) setHumanRequested(true);
      setQuickActions(payload.escalate === true
        ? [{ label: "Volver al inicio", action: "reset" }]
        : [{ label: "Hablar con un humano", action: "human" }, { label: "Volver al inicio", action: "reset" }]);
    } catch {
      setMessages((current) => current.map((message) => message.id === placeholderId
        ? { ...message, text: "No pude responder en este momento. Puedes volver a intentarlo o hablar con una persona." }
        : message));
      setQuickActions([{ label: "Hablar con un humano", action: "human" }, { label: "Volver al inicio", action: "reset" }]);
    } finally {
      setAiLoading(false);
    }
  }

  function handleFreeText(value: string) {
    const text = value.trim();
    if (!text) return;
    setDraft("");
    const normalized = normalizeText(text);
    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hey)[!. ,]*$/.test(normalized)) {
      return appendConversation(text, "Hola. ¿En qué puedo ayudarte? Puedo orientarte sobre tu cuenta de hospitalización, el PAM, un resultado preliminar o la privacidad.", INITIAL_ACTIONS);
    }
    if (normalized.includes("humano") || normalized.includes("persona") || normalized.includes("whatsapp")) return requestHuman(text);
    if (pendingQuestion === "detailed" && isYes(text)) return handleAction("detailed_yes", text);
    if (pendingQuestion === "detailed" && isNo(text)) return handleAction("detailed_no", text);
    if (pendingQuestion === "pam" && isYes(text)) return handleAction("pam_yes", text);
    if (pendingQuestion === "pam" && isNo(text)) return handleAction("pam_no", text);
    if (normalized.includes("pam") || normalized.includes("isapre")) return handleAction("pam_info", text);
    if (normalized.includes("resultado") || normalized.includes("informe") || normalized.includes("monto")) return handleAction("result", text);
    if (normalized.includes("cuenta") || normalized.includes("subir") || normalized.includes("documento") || normalized.includes("detalle")) return askDetailed(text);
    if (normalized.includes("privacidad") || normalized.includes("dato") || normalized.includes("run")) {
      return appendConversation(text, "No compartas RUN ni documentos aquí. El acceso seguro verifica el correo y permite cargar los antecedentes con autorización separada.", [
        { label: "Quiero subir mi cuenta", action: "upload" },
        { label: "Hablar con un humano", action: "human" },
      ]);
    }
    return void requestAiAnswer(text);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleFreeText(draft);
  }

  return (
    <div className={`support-chat-widget${open ? " is-open" : ""}`}>
      {open && (
        <section id="support-chat-panel" className="support-chat-card" role="dialog" aria-modal="false" aria-labelledby="support-chat-title">
          <header className="support-chat-header">
            <div>
              <p className="support-chat-kicker">Orientación inicial</p>
              <h2 id="support-chat-title">Chatbox</h2>
            </div>
            <button className="support-chat-close" type="button" aria-label="Cerrar Chatbox" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="support-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <div className={`support-chat-message ${message.role}`} key={message.id}>
                {message.text}
              </div>
            ))}
            <div ref={messagesEnd} />
          </div>
          <div className="support-chat-actions">
            {quickActions.map((item) => (
              item.action === "upload_link" ? (
                <a className="support-chat-action" href={PATIENT_UPLOAD_URL} key={item.action} aria-disabled={aiLoading}>{item.label} ↗</a>
              ) : (
                <button className="support-chat-action" type="button" key={item.action} onClick={() => handleAction(item.action, item.label)} disabled={aiLoading}>{item.label}</button>
              )
            ))}
          </div>
          {humanRequested && (
            <a className="support-chat-human-link" href={whatsappHref} target="_blank" rel="noreferrer">
              Abrir WhatsApp de atención ↗
            </a>
          )}
          <form className="support-chat-form" onSubmit={handleSubmit}>
            <input aria-label="Escribe tu pregunta" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escribe tu pregunta" disabled={aiLoading} />
            <button type="submit" aria-label="Enviar pregunta" disabled={aiLoading}>{aiLoading ? "…" : "Enviar"}</button>
          </form>
          <p className="support-chat-note">Orientación general. No compartas RUN ni documentos en este chat.</p>
        </section>
      )}
      <button className="support-chat-launcher" type="button" aria-expanded={open} aria-controls="support-chat-panel" onClick={() => setOpen((value) => !value)}>
        <span className="support-chat-mark" aria-hidden="true">?</span>
        {open ? "Cerrar Chatbox" : "Chatbox"}
      </button>
    </div>
  );
}
