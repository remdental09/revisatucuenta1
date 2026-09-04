import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Política de privacidad | RevisaTuCuenta",
  description: "Información sobre el tratamiento de datos personales y documentos de salud en RevisaTuCuenta.",
};

export default function PrivacyPage() {
  return <LegalPage section="privacy" />;
}
