import {
  mergeObservedCorpus,
  OBSERVED_CHILEAN_ACCOUNT_CORPUS,
  type ObservedCorpusContribution,
  type ObservedCorpus,
} from "../rules/observed-corpus.ts";
import type { ChileanBillingLine } from "../rules/chilean-account.ts";
import { ensureCaseSchema } from "./case-schema.ts";

export type CorpusContributionStatus = "pending_review" | "validated" | "rejected";
export type CorpusSourceKind = "account" | "pam";

type StoredContribution = {
  caseId: string;
  status: CorpusContributionStatus;
  contribution: ObservedCorpusContribution;
  updatedAt: string;
};

type CorpusState = Map<string, StoredContribution>;
const runtimeGlobal = globalThis as typeof globalThis & { __revisaTuCuentaCorpusState?: CorpusState };
const localContributions = runtimeGlobal.__revisaTuCuentaCorpusState ??= new Map<string, StoredContribution>();

export function buildCorpusContribution(input: {
  caseId: string;
  episodeClass?: string;
  lines: ChileanBillingLine[];
  sourceKind?: CorpusSourceKind;
  sourceDocumentId?: string;
}): ObservedCorpusContribution {
  const providers = Array.from(new Set(input.lines.map((line) => line.providerId).filter(Boolean))) as string[];
  return {
    caseKey: `runtime-${input.caseId}`,
    sourceKinds: [input.sourceKind || "account"],
    sourceDocumentIds: input.sourceDocumentId ? [input.sourceDocumentId] : [],
    provider: providers.join(", ") || undefined,
    episodeClass: input.episodeClass || "Cuenta clínica",
    sourceLineCount: input.lines.length,
    observedLineCount: input.lines.length,
    coverage: "verified_fragmentation_subset",
    coverageNote: "Líneas extraídas y analizadas por el motor; incorporación pendiente de validación interna.",
    lines: input.lines.map((line) => ({
      description: line.description,
      amount: line.amount,
      code: line.code,
      fonasaCode: line.fonasaCode,
      section: line.section,
      subgroup: line.subgroup,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      provider: line.providerId,
    })),
  };
}

function contributionLineKey(line: ObservedCorpusContribution["lines"][number]) {
  return [
    line.code || "",
    line.fonasaCode || "",
    line.description.trim().toLowerCase(),
    line.section || "",
    line.subgroup || "",
    line.quantity ?? "",
    line.unitAmount ?? "",
    line.amount,
  ].join("|");
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function mergeContributions(
  previous: ObservedCorpusContribution | undefined,
  next: ObservedCorpusContribution,
) {
  if (!previous) return { contribution: next, addedLines: next.lines.length };
  const existingKeys = new Set(previous.lines.map(contributionLineKey));
  const added = next.lines.filter((line) => !existingKeys.has(contributionLineKey(line)));
  const lines = [...previous.lines, ...added];
  return {
    addedLines: added.length,
    contribution: {
      ...previous,
      episodeClass: uniqueStrings([previous.episodeClass, next.episodeClass]).join(" + ") || "Cuenta clínica",
      sourceKinds: Array.from(new Set([...(previous.sourceKinds || []), ...(next.sourceKinds || [])])),
      sourceDocumentIds: uniqueStrings([...(previous.sourceDocumentIds || []), ...(next.sourceDocumentIds || [])]),
      provider: uniqueStrings([previous.provider, next.provider]).join(", ") || undefined,
      sourceLineCount: Math.max(previous.sourceLineCount, next.sourceLineCount),
      observedLineCount: lines.length,
      coverageNote: "Observaciones de cuenta y/o PAM acumuladas; incorporación al corpus activo pendiente de validación interna.",
      lines,
    },
  };
}

function parseContribution(value: unknown): ObservedCorpusContribution | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as ObservedCorpusContribution;
  } catch {
    return undefined;
  }
}

function localRows() {
  return [...localContributions.values()];
}

export async function registerCorpusContribution(
  env: any,
  caseId: string,
  contribution: ObservedCorpusContribution,
): Promise<CorpusContributionStatus> {
  const timestamp = new Date().toISOString();
  if (!env?.DB) {
    const previous = localContributions.get(caseId);
    const merged = mergeContributions(previous?.contribution, contribution);
    const status = previous && merged.addedLines === 0
      ? previous.status
      : "pending_review";
    localContributions.set(caseId, { caseId, status, contribution: merged.contribution, updatedAt: timestamp });
    return status;
  }

  await ensureCaseSchema(env.DB);
  const previousRow = await env.DB.prepare(
    `SELECT status, contribution_json FROM corpus_contributions WHERE case_id = ?`,
  ).bind(caseId).first();
  const previousContribution = parseContribution(previousRow?.contribution_json);
  const merged = mergeContributions(previousContribution, contribution);
  const nextStatus = previousRow && merged.addedLines === 0
    ? String(previousRow.status) as CorpusContributionStatus
    : "pending_review";
  if (previousRow) {
    await env.DB.prepare(
      `UPDATE corpus_contributions SET status = ?, contribution_json = ?, updated_at = CURRENT_TIMESTAMP WHERE case_id = ?`,
    ).bind(nextStatus, JSON.stringify(merged.contribution), caseId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO corpus_contributions (case_id, status, contribution_json, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(caseId, nextStatus, JSON.stringify(merged.contribution)).run();
  }
  const row = await env.DB.prepare(`SELECT status FROM corpus_contributions WHERE case_id = ?`).bind(caseId).first();
  return (row?.status as CorpusContributionStatus | undefined) || "pending_review";
}

export async function updateCorpusContributionStatus(
  env: any,
  caseId: string,
  status: CorpusContributionStatus,
): Promise<boolean> {
  if (!env?.DB) {
    const previous = localContributions.get(caseId);
    if (!previous) return false;
    localContributions.set(caseId, { ...previous, status, updatedAt: new Date().toISOString() });
    return true;
  }
  await ensureCaseSchema(env.DB);
  const result = await env.DB.prepare(
    `UPDATE corpus_contributions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE case_id = ?`,
  ).bind(status, caseId).run();
  return Number(result.meta?.changes || 0) > 0;
}

export async function getObservedCorpusSnapshot(env: any): Promise<{
  corpus: ObservedCorpus;
  pendingCount: number;
  validatedCount: number;
}> {
  let rows: StoredContribution[];
  if (!env?.DB) {
    rows = localRows();
  } else {
    await ensureCaseSchema(env.DB);
    const result = await env.DB.prepare(
      `SELECT case_id, status, contribution_json, updated_at FROM corpus_contributions`,
    ).all();
    rows = (result.results as Array<Record<string, unknown>>).flatMap((row) => {
      const contribution = parseContribution(row.contribution_json);
      if (!contribution) return [];
      return [{
        caseId: String(row.case_id),
        status: String(row.status) as CorpusContributionStatus,
        contribution,
        updatedAt: String(row.updated_at),
      }];
    });
  }

  const validated = rows
    .filter((row) => row.status === "validated")
    .map((row) => row.contribution);
  return {
    corpus: mergeObservedCorpus(OBSERVED_CHILEAN_ACCOUNT_CORPUS, validated),
    pendingCount: rows.filter((row) => row.status === "pending_review").length,
    validatedCount: validated.length,
  };
}

export async function getCorpusContributionStatus(env: any, caseId: string) {
  if (!env?.DB) return localContributions.get(caseId)?.status;
  await ensureCaseSchema(env.DB);
  const row = await env.DB.prepare(`SELECT status FROM corpus_contributions WHERE case_id = ?`).bind(caseId).first();
  return row?.status as CorpusContributionStatus | undefined;
}
