import type {
  DocumentExtraction,
  ExtractedLine,
  ExtractionField,
  StructuredExtraction,
} from "./types";

export type TextPage = { page: number; text: string };

const normalize = (value: string) =>
  value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();

const amount = (value: string) =>
  Number(value.replace(/[^0-9,-]/g, "").replace(/\./g, "").replace(",", "."));

function findField(
  pages: TextPage[],
  key: string,
  label: string,
  patterns: RegExp[],
  confidence = 88,
): ExtractionField | undefined {
  for (const page of pages) {
    for (const pattern of patterns) {
      const match = page.text.match(pattern);
      if (match?.[1]) {
        return {
          key,
          label,
          value: normalize(match[1]),
          page: page.page,
          confidence,
        };
      }
    }
  }
}

function monetaryLines(pages: TextPage[]): ExtractedLine[] {
  const results: ExtractedLine[] = [];
  for (const page of pages) {
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = normalize(rawLine);
      const match = line.match(/^(.{3,}?)\s+\$?\s*([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})(?:,\d{1,2})?\s*$/);
      if (!match) continue;
      const parsed = amount(match[2]);
      if (!Number.isFinite(parsed)) continue;
      results.push({ description: normalize(match[1]), amount: parsed, page: page.page });
    }
  }
  return results.slice(0, 5000);
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => Boolean(value));
}

export function parseClinicalAccount(pages: TextPage[]): StructuredExtraction {
  const fields = compact([
    findField(pages, "provider", "Prestador", [/(?:cl[ií]nica|hospital|prestador)\s*[:\-]?\s*([^\n]{3,70})/i], 82),
    findField(pages, "patient", "Paciente", [/(?:paciente|nombre)\s*[:\-]\s*([^\n]{3,80})/i]),
    findField(pages, "account_number", "Número de cuenta", [/(?:n[°ºo]\s*)?(?:cuenta|folio)\s*[:\-]?\s*([A-Z0-9.-]{4,})/i]),
    findField(pages, "admission_date", "Fecha de ingreso", [/(?:fecha\s+de\s+)?ingreso\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i]),
    findField(pages, "discharge_date", "Fecha de alta", [/(?:fecha\s+de\s+)?alta\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i]),
    findField(pages, "total", "Total cuenta clínica", [/(?:total\s+(?:cuenta|general)|total\s+a\s+pagar)\s*[:\-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i], 94),
  ]);
  return {
    type: "account",
    label: "Cuenta clínica",
    pages: pages.map((page) => page.page),
    fields,
    lines: monetaryLines(pages),
  };
}

export function parsePam(pages: TextPage[]): StructuredExtraction {
  const fields = compact([
    findField(pages, "payer", "Isapre / financiador", [/(?:isapre|instituci[oó]n|asegurador)\s*[:\-]?\s*([^\n]{3,60})/i], 86),
    findField(pages, "folio", "Folio PAM", [/(?:folio|n[°ºo]\s*(?:pam|liquidaci[oó]n))\s*[:\-]?\s*([A-Z0-9.-]{3,})/i]),
    findField(pages, "beneficiary", "Beneficiario", [/(?:beneficiario|paciente)\s*[:\-]\s*([^\n]{3,80})/i]),
    findField(pages, "billed_total", "Total facturado", [/(?:total\s+(?:facturado|prestaciones|cuenta))\s*[:\-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i], 92),
    findField(pages, "bonus", "Bonificación", [/(?:total\s+)?bonificaci[oó]n\s*[:\-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i], 94),
    findField(pages, "copay", "Copago", [/(?:total\s+)?copago\s*[:\-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i], 94),
  ]);
  return {
    type: "pam",
    label: "PAM / liquidación",
    pages: pages.map((page) => page.page),
    fields,
    lines: monetaryLines(pages),
  };
}

function pageKind(text: string): "account" | "pam" | "unknown" {
  const normalized = text.toLowerCase();
  const pamScore = ["pam", "bonificación", "bonificacion", "copago", "isapre", "liquidación", "liquidacion"].filter((term) => normalized.includes(term)).length;
  const accountScore = ["cuenta clínica", "cuenta clinica", "día cama", "dia cama", "pabellón", "pabellon", "insumos", "farmacia"].filter((term) => normalized.includes(term)).length;
  if (pamScore > accountScore && pamScore > 0) return "pam";
  if (accountScore > 0) return "account";
  return "unknown";
}

export function structureDocument(
  pages: TextPage[],
  expected: "account" | "pam" | "mixed" | "unknown",
  usedOcr: boolean,
): DocumentExtraction {
  let accountPages: TextPage[] = [];
  let pamPages: TextPage[] = [];
  if (expected === "account") accountPages = pages;
  else if (expected === "pam") pamPages = pages;
  else {
    accountPages = pages.filter((page) => pageKind(page.text) === "account");
    pamPages = pages.filter((page) => pageKind(page.text) === "pam");
    const unknown = pages.filter((page) => pageKind(page.text) === "unknown");
    if (!accountPages.length && !pamPages.length) accountPages = unknown;
    else if (unknown.length) {
      const target = accountPages.length >= pamPages.length ? accountPages : pamPages;
      target.push(...unknown);
      target.sort((a, b) => a.page - b.page);
    }
  }
  return {
    pageCount: pages.length,
    usedOcr,
    account: accountPages.length ? parseClinicalAccount(accountPages) : undefined,
    pam: pamPages.length ? parsePam(pamPages) : undefined,
  };
}

