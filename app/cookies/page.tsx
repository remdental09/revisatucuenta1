import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Política de cookies | RevisaTuCuenta",
  description: "Conoce las cookies necesarias y controla tus preferencias en RevisaTuCuenta.",
};

export default function CookiesPage() {
  return <LegalPage section="cookies" />;
}
