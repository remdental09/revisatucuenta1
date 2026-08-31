export const PATIENT_SERVICE_CONTRACT_VERSION = "2026-08-31-v1";
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
    "Estado: borrador operativo de piloto; debe ser revisado y completado por un abogado chileno antes de producción.",
    "",
    "1. PARTES",
    `Prestador del servicio: ${companyName}, RUT ${companyRut}, domicilio ${companyAddress}, representada por ${legalRepresentative}.`,
    `Cliente y titular de los datos: ${input.patientName || "Paciente"}, correo ${input.patientEmail || "correo verificado"}.`,
    `Caso: ${input.episodeLabel || "Revisión de cuenta clínica"}.`,
    "",
    "2. OBJETO DEL SERVICIO",
    `El cliente solicita a ${companyName} una revisión técnica y asesoría administrativa respecto de la cuenta clínica y antecedentes que entregue para el caso indicado. El servicio puede incluir ordenar documentos, detectar posibles inconsistencias, preparar solicitudes de aclaración ante el prestador y preparar o presentar reclamos administrativos cuando corresponda y exista autorización suficiente.`,
    "El análisis es preliminar, depende de los documentos disponibles y no garantiza devolución, cobertura, resultado favorable ni aceptación por parte del prestador o de una autoridad.",
    "",
    "3. MANDATO ESPECIAL Y LIMITADO",
    `El cliente autoriza a ${companyName}, actuando por medio de su representante o de la persona que la sociedad designe para este caso, a solicitar, recibir, ordenar y utilizar exclusivamente los antecedentes relacionados con el episodio indicado, incluyendo cuenta clínica, detalle de cargos, boletas o facturas, PAM o liquidación, documentos de cobertura, respuestas del prestador y las partes pertinentes de la ficha clínica que sean necesarias para la gestión autorizada.`,
    "Asimismo, autoriza preparar, presentar y hacer seguimiento de solicitudes de aclaración y reclamos administrativos ante el prestador y, cuando corresponda, ante la Superintendencia de Salud, dentro de los plazos aplicables.",
    "Este mandato no faculta a consentir tratamientos médicos, tomar decisiones clínicas, renunciar derechos, desistir, transigir, celebrar acuerdos, recibir dinero, cobrar indemnizaciones ni delegar estas facultades, salvo autorización expresa y separada del cliente.",
    "",
    "4. DATOS PERSONALES Y DATOS DE SALUD",
    "El cliente autoriza expresamente el tratamiento de sus datos personales y sensibles, incluidos datos de salud, para: (a) analizar la cuenta y documentos del caso; (b) preparar la asesoría y comunicaciones; (c) solicitar aclaraciones y gestionar los reclamos autorizados; (d) acreditar las actuaciones realizadas; y (e) cumplir obligaciones legales.",
    `Los datos podrán comunicarse únicamente al prestador involucrado, a la Superintendencia de Salud cuando corresponda y a proveedores tecnológicos que ${companyName} utilice para almacenamiento, seguridad, lectura documental o comunicaciones, bajo instrucciones de confidencialidad y seguridad.`,
    "La información se conservará durante el tiempo necesario para cumplir el objeto del servicio, atender obligaciones legales y mantener evidencia de la autorización; luego será eliminada, bloqueada o anonimizada cuando corresponda.",
    "El cliente puede solicitar información, corrección, eliminación o bloqueo cuando proceda, y revocar por escrito la autorización para usos futuros, sin afectar los tratamientos ya realizados lícitamente ni las actuaciones ya presentadas.",
    "",
    "5. OBLIGACIONES DEL CLIENTE",
    "El cliente declara que los documentos y datos entregados son propios, auténticos y completos según su leal saber y entender; debe informar cambios de correo, aportar antecedentes requeridos y revisar el texto final de cada presentación antes de su envío.",
    "",
    "6. PRECIO Y PAGO",
    `Precio de referencia del piloto: ${money(price)}. Este valor es configurable y deberá confirmarse en la versión definitiva del contrato antes de cualquier cobro real. En esta versión de demostración el botón de pago no procesa dinero ni genera una transacción real.`,
    "Cualquier cobro real deberá informar previamente precio, impuestos o cargos aplicables, medio de pago, comprobante y condiciones de devolución o término que correspondan.",
    "",
    "7. VIGENCIA Y REVOCACIÓN",
    "El mandato rige únicamente para el caso y episodio indicados, hasta la conclusión de las gestiones autorizadas o por un máximo de 90 días, lo que ocurra primero, salvo renovación expresa. El cliente puede solicitar su revocación por escrito a través del canal informado por la sociedad.",
    "",
    "8. ACEPTACIÓN Y FORMALIZACIÓN",
    "La aceptación registrada en la plataforma deja constancia de la voluntad del cliente sobre estas condiciones. Para la gestión que requiera acreditar acceso a ficha clínica o representación ante terceros, la sociedad deberá utilizar un poder ante notario o un sistema electrónico que garantice autenticidad conforme a la Ley 19.799, según lo acepte el destinatario. La versión de producción deberá integrar firma electrónica avanzada o el mecanismo formal que corresponda.",
    "",
    "9. LEGISLACIÓN APLICABLE",
    "Este documento se interpreta conforme a la legislación chilena vigente, especialmente la Ley 19.628 sobre protección de la vida privada, la Ley 20.584 sobre derechos y deberes en salud, la Ley 19.799 sobre documentos y firma electrónica y demás normas aplicables. La sociedad deberá actualizarlo cuando entre en vigor la Ley 21.719 y cuando exista normativa sectorial que corresponda.",
    "",
    "El cliente declara que pudo leer este documento, consultar dudas y obtener una copia de la versión aceptada.",
  ].join("\n");
}
