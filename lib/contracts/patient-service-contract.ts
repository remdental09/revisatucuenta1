export const PATIENT_SERVICE_CONTRACT_VERSION = "2026-09-05-v2-cl";
export const DEFAULT_PATIENT_SERVICE_PRICE_CLP = 29_900;

export type PatientServiceContractInput = {
  patientName: string;
  patientEmail: string;
  episodeLabel: string;
  companyName?: string;
  companyRut?: string;
  companyAddress?: string;
  legalRepresentative?: string;
  priceClp?: number;
};

function money(value: number) {
  return `$${Math.max(0, Math.round(value)).toLocaleString("es-CL")} CLP`;
}

function clean(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

/**
 * This is intentionally a plain-text, versioned contract so that the exact
 * content shown to the patient can be stored with the acceptance record.
 * The legal entity details must be completed from the final company records
 * before this is used in production.
 */
export function buildPatientServiceContract(input: PatientServiceContractInput) {
  const companyName = clean(input.companyName, "Rakun SpA");
  const companyRut = clean(input.companyRut, "[RUT de la sociedad por completar]");
  const companyAddress = clean(input.companyAddress, "[Domicilio de la sociedad por completar]");
  const legalRepresentative = clean(input.legalRepresentative, "el representante legal vigente de la sociedad");
  const price = input.priceClp ?? DEFAULT_PATIENT_SERVICE_PRICE_CLP;

  return [
    "CONTRATO DE PRESTACIÓN DE SERVICIOS, MANDATO ESPECIAL Y AUTORIZACIÓN DE TRATAMIENTO DE DATOS",
    `Versión: ${PATIENT_SERVICE_CONTRACT_VERSION}`,
    "Estado: versión preliminar para validación legal y puesta en producción en Chile.",
    "",
    "1. PARTES",
    `Prestador del servicio: ${companyName}, RUT ${companyRut}, domicilio ${companyAddress}, representada por ${legalRepresentative}.`,
    `Cliente y titular de los datos: ${input.patientName || "Paciente"}, correo ${input.patientEmail || "correo verificado"}.`,
    `Caso: ${input.episodeLabel || "Revisión de cuenta clínica"}.`,
    "",
    "2. OBJETO Y ETAPAS DEL SERVICIO",
    `La carga de antecedentes y la evaluación preliminar inicial de ${companyName} son gratuitas y no crean por sí solas un mandato ni una obligación de pago. Si el cliente acepta una propuesta de acompañamiento, este contrato regula ese servicio respecto del caso indicado.`,
    `El acompañamiento consiste en revisar y ordenar la cuenta clínica, PAM o liquidación, coberturas y respuestas recibidas; identificar inconsistencias documentales o de cobro; explicar alternativas en lenguaje claro; preparar solicitudes de aclaración y, cuando corresponda y exista autorización suficiente, preparar o presentar reclamos administrativos ante el prestador o la Superintendencia de Salud.`,
    "La consultora presta apoyo administrativo y documental. No es un establecimiento de salud, no entrega consejo médico, no presta servicios jurídicos ni representa al cliente en sede judicial. El análisis depende de los antecedentes disponibles y no garantiza devolución, cobertura, resultado favorable ni aceptación por parte del prestador, la Isapre, Fonasa o una autoridad.",
    "",
    "3. MANDATO ESPECIAL, LIMITADO Y REVOCABLE",
    `El cliente autoriza a ${companyName}, actuando por medio de su representante o de la persona que la sociedad designe para este caso, a solicitar, recibir, ordenar y utilizar exclusivamente los antecedentes relacionados con el episodio indicado, incluyendo cuenta clínica, detalle de cargos, boletas o facturas, PAM o liquidación, documentos de cobertura, respuestas del prestador y las partes pertinentes de la ficha clínica que sean necesarias para la gestión autorizada.`,
    "Asimismo, autoriza preparar, presentar y hacer seguimiento de solicitudes de aclaración y reclamos administrativos ante el prestador y, cuando corresponda, ante la Superintendencia de Salud, dentro de los plazos aplicables y con revisión del cliente cuando la presentación lo requiera.",
    "Este mandato no faculta a consentir tratamientos médicos, tomar decisiones clínicas, renunciar derechos, desistir, transigir, celebrar acuerdos, reconocer deudas, firmar convenios, recibir dinero, cobrar indemnizaciones, iniciar acciones judiciales ni delegar estas facultades, salvo autorización expresa y separada del cliente. Es revocable por escrito y sólo rige para el episodio indicado.",
    "",
    "4. DATOS PERSONALES, DATOS DE SALUD Y CONFIDENCIALIDAD",
    "El cliente autoriza expresamente el tratamiento de sus datos personales y sensibles, incluidos datos de salud, para: (a) analizar la cuenta y documentos del caso; (b) preparar la asesoría y comunicaciones; (c) solicitar aclaraciones y gestionar los reclamos autorizados; (d) acreditar las actuaciones realizadas; y (e) cumplir obligaciones legales.",
    `Los datos podrán comunicarse únicamente al prestador involucrado, a la Superintendencia de Salud cuando corresponda y a proveedores tecnológicos que ${companyName} utilice para almacenamiento, seguridad, lectura documental o comunicaciones, bajo instrucciones de confidencialidad y seguridad.`,
    "La información se conservará durante el tiempo necesario para cumplir el objeto del servicio, atender obligaciones legales y mantener evidencia de la autorización; luego será eliminada, bloqueada o anonimizada cuando corresponda. No se venderán datos ni se usarán para publicidad ajena al servicio.",
    "El cliente puede solicitar información, corrección, eliminación o bloqueo cuando proceda, y revocar por escrito la autorización para usos futuros, sin afectar los tratamientos ya realizados lícitamente ni las actuaciones ya presentadas. La consultora informará un canal de contacto para ejercer estos derechos en la versión de producción.",
    "",
    "5. OBLIGACIONES DE LAS PARTES",
    "El cliente declara que los documentos y datos entregados son propios, auténticos y completos según su leal saber y entender; debe informar cambios de correo, aportar antecedentes requeridos y revisar el texto final de cada presentación antes de su envío. Los plazos de respuesta de terceros no dependen de la consultora.",
    `${companyName} deberá informar de manera comprensible el avance, los antecedentes faltantes, las alternativas identificadas y el cierre del caso. Podrá suspender la gestión si faltan documentos, existe un riesgo de representación inadecuada o la solicitud excede el mandato otorgado.`,
    "",
    "6. PRECIO, PAGO Y TÉRMINO",
    `El precio total del acompañamiento administrativo para este caso es ${money(price)}, salvo que el cliente acepte una propuesta distinta y quede registrada antes del cobro. La evaluación preliminar inicial es gratuita. En esta versión de demostración el botón de pago no procesa dinero ni genera una transacción real.`,
    "Antes de cualquier cobro real se informarán precio, impuestos o cargos aplicables, medio de pago, comprobante y condiciones de término o devolución que correspondan conforme a la Ley 19.496 y demás normas aplicables. No se cobrará un porcentaje de una eventual devolución salvo pacto escrito, separado y válido.",
    "",
    "7. VIGENCIA, CIERRE Y REVOCACIÓN",
    "El contrato y el mandato rigen únicamente para el caso y episodio indicados, hasta la conclusión de las gestiones autorizadas o por un máximo de 90 días, lo que ocurra primero, salvo renovación expresa. El cliente puede solicitar su revocación o término por escrito a través del canal informado por la sociedad. Al cerrar, la consultora entregará un resumen de actuaciones y antecedentes que corresponda conservar.",
    "",
    "8. ACEPTACIÓN Y FORMALIZACIÓN",
    "La aceptación registrada en la plataforma deja constancia de la voluntad del cliente sobre estas condiciones y genera una copia de la versión aceptada. Para la gestión que requiera acreditar acceso a ficha clínica o representación ante terceros, la sociedad deberá utilizar un poder ante notario o un sistema electrónico que garantice autenticidad conforme a la Ley 19.799, según lo acepte el destinatario. La versión de producción deberá integrar firma electrónica avanzada o el mecanismo formal que corresponda.",
    "",
    "9. LEGISLACIÓN APLICABLE Y RECLAMOS",
    "Este documento se interpreta conforme a la legislación chilena vigente, especialmente la Ley 19.628 sobre protección de la vida privada, la Ley 20.584 sobre derechos y deberes en salud, la Ley 19.799 sobre documentos y firma electrónica, la Ley 19.496 cuando corresponda y demás normas aplicables. La sociedad deberá actualizarlo cuando entre en vigor la Ley 21.719 y cuando exista normativa sectorial que corresponda.",
    "Las solicitudes sobre la cuenta se dirigirán primero al prestador o asegurador correspondiente y, cuando proceda, podrán escalarse a la Superintendencia de Salud. Este contrato no impide al cliente ejercer directamente sus derechos ni contratar asesoría legal independiente.",
    "",
    "El cliente declara que pudo leer este documento, consultar dudas y obtener una copia de la versión aceptada.",
  ].join("\n");
}
