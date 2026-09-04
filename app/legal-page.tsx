import type { ReactNode } from "react";
import Link from "next/link";

type LegalSection = "privacy" | "cookies";

function LegalBrand() {
  return (
    <Link className="legal-brand" href="/">
      <span>R</span>
      <strong>RevisaTuCuenta</strong>
    </Link>
  );
}

function LegalList({ children }: { children: ReactNode }) {
  return <ul className="legal-list">{children}</ul>;
}

function PrivacyContent() {
  return (
    <>
      <p className="legal-lead">Esta política explica qué información puede tratar RevisaTuCuenta cuando una persona solicita una revisión de su cuenta de hospitalización.</p>

      <h2>1. Responsable y canal de privacidad</h2>
      <p>El responsable es la entidad que opera RevisaTuCuenta. Antes de iniciar operaciones comerciales, deben completarse en este documento la razón social, RUT, domicilio y el correo formal para ejercer derechos. Durante el piloto, las solicitudes pueden dirigirse al canal de contacto informado por la sociedad.</p>

      <h2>2. Información que tratamos</h2>
      <LegalList>
        <li>Correo electrónico, para verificar el acceso y enviar enlaces de sesión.</li>
        <li>Nombre y RUN, para asociar la revisión con la persona que la solicita.</li>
        <li>Cuenta de hospitalización, PAM o liquidación, documentos y datos de salud contenidos en ellos.</li>
        <li>Resultado preliminar, actividad del caso, autorizaciones y comunicaciones relacionadas.</li>
        <li>Datos técnicos mínimos necesarios para seguridad, funcionamiento y prevención de abuso.</li>
      </LegalList>
      <p>Los datos de salud son datos personales sensibles. La autorización para tratarlos se solicita de manera separada y no se entiende otorgada por aceptar cookies.</p>

      <h2>3. Para qué usamos la información</h2>
      <LegalList>
        <li>Verificar que sólo el correo autorizado acceda a la revisión.</li>
        <li>Ordenar y leer los documentos entregados, generar un resultado preliminar y permitir su revisión humana cuando corresponda.</li>
        <li>Preparar comunicaciones, solicitudes de aclaración o gestiones administrativas que la persona autorice.</li>
        <li>Proteger la plataforma, mantener trazabilidad, atender solicitudes de la persona y cumplir obligaciones legales.</li>
      </LegalList>
      <p>El resultado es preliminar: no constituye por sí solo una decisión médica, una declaración de cobro indebido ni una promesa de devolución.</p>

      <h2>4. Proveedores y comunicaciones</h2>
      <p>Podemos utilizar proveedores tecnológicos para hosting, base de datos, almacenamiento de documentos, correo transaccional, lectura documental y seguridad. Cada proveedor debe operar sólo según el encargo recibido, con confidencialidad y medidas de seguridad. Los datos sólo se comunicarán al prestador involucrado, a la autoridad competente cuando corresponda o a proveedores necesarios para prestar el servicio.</p>
      <p>Cloudflare informa que ciertos datos técnicos de sus cookies pueden procesarse por defecto en Estados Unidos. Esta transferencia y las de cualquier otro proveedor deben mantenerse descritas y actualizadas en la versión vigente de esta política.</p>

      <h2>5. Conservación y eliminación</h2>
      <p>El documento original se elimina después de una extracción exitosa. Si la lectura requiere revisión humana, la fuente queda retenida como máximo por 72 horas, sujeto a que la eliminación técnica se complete. Los datos estructurados del caso, autorizaciones y resultado se conservan sólo durante la gestión, los plazos legales aplicables y el período de evidencia que defina la sociedad; luego deben eliminarse, bloquearse o anonimizarse cuando corresponda.</p>

      <h2>6. Derechos y revocación</h2>
      <p>La persona puede solicitar información sobre sus datos, corrección y, cuando corresponda, eliminación, bloqueo u oposición; también puede revocar autorizaciones para usos futuros. La revocación no invalida tratamientos realizados lícitamente ni actuaciones ya presentadas. La sociedad debe habilitar un canal verificable y responder conforme a la ley aplicable.</p>

      <h2>7. Seguridad y privacidad por diseño</h2>
      <p>El acceso se verifica por correo, las sesiones usan una cookie HttpOnly y Secure en producción, y los documentos originales se eliminan según el ciclo indicado. No se deben incorporar herramientas de analítica o publicidad que reciban RUN, correo, identificadores de casos, URLs con información clínica o documentos de pacientes.</p>

      <h2>8. Cambios</h2>
      <p>La política debe mostrar siempre su versión y fecha. Los cambios relevantes deben comunicarse antes de aplicar una nueva finalidad. Esta versión corresponde al piloto y debe ser revisada por asesoría jurídica chilena antes de operar comercialmente.</p>
    </>
  );
}

function CookiesContent() {
  return (
    <>
      <p className="legal-lead">Usamos únicamente cookies técnicas necesarias para que el acceso verificado y la protección de RevisaTuCuenta funcionen. No hay cookies de analítica, publicidad ni personalización activas actualmente.</p>

      <h2>Cookies activas</h2>
      <div className="legal-table" role="table" aria-label="Cookies activas">
        <div className="legal-table-row legal-table-heading" role="row">
          <span>Cookie / proveedor</span><span>Finalidad</span><span>Duración</span>
        </div>
        <div className="legal-table-row" role="row">
          <span><code>rtc_session</code><br />RevisaTuCuenta</span>
          <span>Mantener la sesión del correo verificado y restringir el acceso al caso.</span>
          <span>Hasta 7 días</span>
        </div>
        <div className="legal-table-row" role="row">
          <span><code>__cf_bm</code><br />Cloudflare</span>
          <span>Protección contra tráfico automatizado y abuso.</span>
          <span>Hasta 30 minutos de inactividad</span>
        </div>
      </div>

      <h2>Cookies opcionales</h2>
      <p>No están activas. Si en el futuro se incorpora analítica, publicidad o personalización, se solicitará autorización previa y separada antes de cargarlas. Quedarán apagadas por defecto y “Rechazar opcionales” tendrá la misma visibilidad y facilidad que cualquier aceptación.</p>

      <h2>Cómo cambiar tu decisión</h2>
      <p>El botón “Cookies” permanece disponible en el sitio para revisar la selección. La preferencia se guarda sólo en el dispositivo, sin incluir RUN, correo, documentos ni información clínica. Cambiar la decisión no autoriza ningún tratamiento de datos de salud.</p>

      <h2>Transferencias y terceros</h2>
      <p>Cloudflare puede procesar datos técnicos de seguridad en Estados Unidos según su configuración y política. La sociedad debe revisar y actualizar esta página si incorpora nuevos proveedores, herramientas o transferencias internacionales.</p>
    </>
  );
}

export function LegalPage({ section }: { section: LegalSection }) {
  const cookies = section === "cookies";
  return (
    <main className="legal-page">
      <header className="legal-header">
        <LegalBrand />
        <nav aria-label="Documentos legales">
          <a href="/privacidad">Privacidad</a>
          <a href="/cookies">Cookies</a>
          <Link href="/">Volver al inicio</Link>
        </nav>
      </header>
      <article className="legal-document">
        <p className="legal-kicker">DOCUMENTO DE PRIVACIDAD · PILOTO</p>
        <h1>{cookies ? "Política de cookies" : "Política de privacidad"}</h1>
        <p className="legal-version">Versión 2026-09-04-v1 · publicada el 4 de septiembre de 2026</p>
        <div className="legal-notice"><strong>Importante:</strong> esta versión describe el piloto. La entidad operadora debe completar sus datos legales y validar el texto con asesoría jurídica chilena antes del uso comercial.</div>
        {cookies ? <CookiesContent /> : <PrivacyContent />}
        <footer className="legal-footer"><LegalBrand /><span>Revisa tus cuentas de hospitalización en clínicas.</span></footer>
      </article>
    </main>
  );
}
