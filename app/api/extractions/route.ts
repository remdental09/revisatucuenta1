import { env } from "cloudflare:workers";
import type { DocumentExtraction, ExtractionField } from "../../../lib/extraction/types";
import { ensureCaseSchema } from "../../../lib/server/case-schema.ts";

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
  await ensureCaseSchema(env.DB);
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
  await env.DB.prepare(`INSERT INTO document_extractions (id, document_id, extraction_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(document_id) DO UPDATE SET extraction_json = excluded.extraction_json, updated_at = CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), body.documentId, JSON.stringify(body.extraction)).run();
  const document = await env.DB.prepare(`SELECT case_id FROM documents WHERE id = ?`).bind(body.documentId).first();
  if (document?.case_id) {
    await env.DB.prepare(`INSERT INTO case_activities (id, case_id, title, detail) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), String(document.case_id), "Extracción completada", "Los campos y líneas quedaron vinculados a su documento de origen.").run();
  }
  return Response.json({ savedFields: fields.length }, { status: 201 });
}
