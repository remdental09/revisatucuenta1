import { env } from "cloudflare:workers";
import type { DocumentExtraction, ExtractionField } from "../../../lib/extraction/types";

type ExtractionRequest = { documentId?: string; extraction?: DocumentExtraction };

function rows(extraction: DocumentExtraction) {
  const groups = [extraction.account, extraction.pam].filter(Boolean);
  return groups.flatMap((group) =>
    (group?.fields ?? []).map((field: ExtractionField) => ({
      ...field,
      key: `${group?.type}.${field.key}`,
    })),
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExtractionRequest;
  if (!body.documentId || !body.extraction) {
    return Response.json({ error: "Extracción o documento ausente" }, { status: 400 });
  }
  const fields = rows(body.extraction);
  if (fields.length) {
    await env.DB.batch(
      fields.map((field) =>
        env.DB.prepare(
          `INSERT OR REPLACE INTO extracted_fields (id, document_id, field_key, field_value, source_page, source_region, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          body.documentId,
          field.key,
          field.value,
          field.page,
          null,
          field.confidence,
        ),
      ),
    );
  }
  return Response.json({ savedFields: fields.length }, { status: 201 });
}

