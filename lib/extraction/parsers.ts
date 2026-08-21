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

function parseNumber(value: string) {
  return amount(value.replace(/^\$/, ""));
}

function splitAccountPrefix(value: string) {
  const normalized = normalize(value);
  const catalogWithReference = normalized.match(/^([56]\d{8})(\d+)\s+(.+)$/i);
  if (catalogWithReference) {
    return {
      code: catalogWithReference[1],
      description: normalize(`${catalogWithReference[2]} ${catalogWithReference[3]}`),
    };
  }
  const separated = normalized.match(/^([0-9][0-9.-]{5,20})\s+(.+)$/i);
  if (separated) {
    return { code: separated[1], description: normalize(separated[2]) };
  }
  const compact = normalized.match(/^((?:[56]\d{8}|\d{6,8}))(.*)$/i);
  if (!compact) return;
  const code = compact[1];
  const description = normalize(compact[2]);
  if (!description) return;
  return { code, description };
}

function accountTableLine(line: string, page: number, section?: string): ExtractedLine | undefined {
  const dateMatch = line.match(/\d{2}[/-]\d{2}[/-]\d{4}\b/);
  if (!dateMatch || dateMatch.index === undefined) return;
  const prefix = splitAccountPrefix(line.slice(0, dateMatch.index).trim());
  if (!prefix) return;
  const { code, description } = prefix;
  if (description.length < 3 || /^(total|bonif)/i.test(description)) return;
  const tail = line.slice(dateMatch.index + dateMatch[0].length).trim();
  const values = tail.match(/^(-?[\d.]+(?:,\d+)?)\s+(\d+(?:[.,]\d+)?)\s+\(?(-?[\d.]+(?:,\d+)?)\)?(?:\s+\*)?$/);
  const tokens = tail.split(/\s+/);
  const quantityIndex = tokens.findIndex((token) => /^\d{1,3},\d{3}$/.test(token));
  const unitAmountToken = quantityIndex >= 0
    ? tokens.slice(quantityIndex + 1).find((token) => /^\$?[\d.]+(?:,\d+)?$/.test(token))
    : undefined;
  if (!values && (!unitAmountToken || quantityIndex < 0)) return;
  const unitAmount = values ? parseNumber(values[1]) : parseNumber(unitAmountToken!);
  const quantity = values
    ? Number(values[2].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."))
    : Number(tokens[quantityIndex].replace(".", "").replace(",", "."));
  const total = values ? parseNumber(values[3]) : Math.round(unitAmount * quantity);
  if (!Number.isFinite(unitAmount) || !Number.isFinite(quantity) || !Number.isFinite(total)) return;
  const fonasaCode = values ? undefined : tokens.slice(0, quantityIndex).find((token) => /^\d{7}$/.test(token));
  return {
    code,
    description,
    amount: total,
    unitAmount,
    quantity,
    date: dateMatch[0],
    fonasaCode,
    section,
    page,
  };
}

function pamTableLine(line: string, page: number, neighborDescription = ""): ExtractedLine | undefined {
  const match = line.match(
    /^([0-9]{6,8})(?:\s+(.+?))?\s+(\d+(?:[.,]\d+)?)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s+\$\s*([0-9.]+)\s*$/,
  );
  if (!match) return;
  const quantity = Number(match[3].replace(",", "."));
  const value = parseNumber(match[4]);
  if (!Number.isFinite(quantity) || !Number.isFinite(value)) return;
  return {
    code: match[1],
    description: normalize(match[2] || neighborDescription || `Prestación ${match[1]}`),
    quantity,
    unitAmount: quantity ? value / quantity : value,
    amount: value,
    page,
  };
}

function sectionFromLine(line: string, current?: string) {
  const upper = line.toUpperCase();
  if (/DIA CAMA|HOSPITALIZ/.test(upper)) return "Hospitalización";
  if (/PABELLON|PABELLÓN/.test(upper)) return "Pabellón";
  if (/HONORARIO/.test(upper)) return "Honorarios";
  if (/MATERIALES|INSUMOS/.test(upper)) return "Materiales clínicos";
  if (/F[ÁA]RMACOS|FARMACIA|MEDICAMENTOS/.test(upper)) return "Medicamentos";
  if (/ANATOMIA PATOLOGICA|RAYOS X|BANCO DE SANGRE/.test(upper)) return normalize(line);
  return current;
}

function monetaryLines(pages: TextPage[], kind: "account" | "pam"): ExtractedLine[] {
  const results: ExtractedLine[] = [];
  let section: string | undefined;
  for (const page of pages) {
    const rawLines = page.text.split(/\r?\n/).map(normalize).filter(Boolean);
    for (let index = 0; index < rawLines.length; index += 1) {
      const rawLine = rawLines[index];
      const line = normalize(rawLine);
      section = sectionFromLine(line, section);
      const previous = rawLines[index - 1] ?? "";
      const next = rawLines[index + 1] ?? "";
      const neighborDescription = [previous, next]
        .filter((candidate) =>
          candidate &&
          !/^\d{6,8}\b/.test(candidate) &&
          !/^(?:total|c[oó]digo|prestaci[oó]n|otras coberturas|forma de pago)/i.test(candidate),
        )
        .join(" ");
      const structured = kind === "account"
        ? accountTableLine(line, page.page, section)
        : pamTableLine(line, page.page, neighborDescription);
      if (structured) {
        results.push(structured);
        continue;
      }
      const match = line.match(/^(.{3,}?)\s+\$?\s*([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})(?:,\d{1,2})?\s*$/);
      if (!match) continue;
      if (kind === "pam") continue;
      if (/^(?:total|subtotal|bonif|valor|cl[ií]nica\b|servicios\s+m[eé]dicos\b|asociaci[oó]n\s+m[eé]dica\b|[\d.$])/i.test(match[1].trim())) continue;
      if (!/[.$]/.test(match[2]) && normalize(match[1]).split(/\s+/).length <= 2) continue;
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
    findField(pages, "provider", "Prestador", [/Empresa\s+Emisora\s*:\s*([^\n]{3,70})/i, /(?:cl[ií]nica|hospital|prestador)\s*[:-]?\s*([^\n]{3,70})/i], 82),
    findField(pages, "patient", "Paciente", [/Paciente\s*:\s*(.+?)\s+Rut\s+Paciente/i, /(?:paciente|nombre)\s*[:-]\s*([^\n]{3,80})/i]),
    findField(pages, "account_number", "Número de cuenta", [/Id\.?\s*Ingreso\s*:\s*([0-9.\s-]+)/i, /(?:n[°ºo]\s*)?(?:cuenta|folio)\s*[:-]?\s*([A-Z0-9.-]{4,})/i]),
    findField(pages, "admission_date", "Fecha de ingreso", [/(?:fecha\s+de\s+)?ingreso\s*[:-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i]),
    findField(pages, "discharge_date", "Fecha de alta", [/(?:fecha\s+(?:de\s+)?(?:alta|egreso))\s*[:-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i]),
    findField(pages, "total", "Total cuenta clínica", [/(?:total\s+(?:cuenta|general)|total\s+a\s+pagar)\s*[:-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i], 94),
  ]);
  return {
    type: "account",
    label: "Cuenta clínica",
    pages: pages.map((page) => page.page),
    fields,
    lines: monetaryLines(pages, "account"),
  };
}

export function parsePam(pages: TextPage[]): StructuredExtraction {
  const fields = compact([
    findField(pages, "payer", "Isapre / financiador", [/(?:isapre|instituci[oó]n|asegurador)\s*[:-]?\s*([^\n]{3,60})/i], 86),
    findField(pages, "folio", "Folio PAM", [/(?:folio|n[°ºo]\s*(?:pam|liquidaci[oó]n))\s*[:-]?\s*([A-Z0-9.-]{3,})/i]),
    findField(pages, "beneficiary", "Beneficiario", [/(?:beneficiario|paciente)\s*[:-]\s*([^\n]{3,80})/i]),
    findField(pages, "billed_total", "Total facturado", [/(?:total\s+(?:facturado|prestaciones|cuenta))\s*[:-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i, /Total\s+\$\s*([0-9.]+)/i], 92),
    findField(pages, "bonus", "Bonificación", [/(?:total\s+)?bonificaci[oó]n(?:\s+isapre)?\s*[:-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i, /Total\s+\$\s*[0-9.]+\s+\$\s*([0-9.]+)/i], 94),
    findField(pages, "copay", "Copago", [/(?:total\s+)?copago(?:\s+afiliado)?\s*[:-]?\s*\$?\s*([0-9.]+(?:,\d{1,2})?)/i, /Total\s+\$\s*[0-9.]+\s+\$\s*[0-9.]+\s+\$\s*([0-9.]+)/i], 94),
  ]);
  return {
    type: "pam",
    label: "PAM / liquidación",
    pages: pages.map((page) => page.page),
    fields,
    lines: monetaryLines(pages, "pam"),
  };
}

function pageKind(text: string): "account" | "pam" | "unknown" {
  const normalized = text.toLowerCase();
  const pamScore = ["pam", "bono hospitalario", "bonificación", "bonificacion", "copago", "isapre", "liquidación", "liquidacion"].filter((term) => normalized.includes(term)).length;
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
