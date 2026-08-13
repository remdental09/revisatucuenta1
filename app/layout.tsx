import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RevisaTuCuenta | Entiende y revisa tu cuenta clínica",
  description:
    "Organiza tu cuenta clínica, PAM y contrato en un solo caso y descubre qué conviene revisar.",
  metadataBase: new URL("https://revisatucuenta.cl"),
  openGraph: {
    title: "RevisaTuCuenta",
    description: "Entiende lo que te cobraron. Reclama con fundamento.",
    images: [{ url: "/og.png", width: 1736, height: 907, alt: "RevisaTuCuenta: documentos clínicos organizados en un expediente" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RevisaTuCuenta",
    description: "Entiende lo que te cobraron. Reclama con fundamento.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
