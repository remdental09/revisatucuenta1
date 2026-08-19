import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  episodeLabel: text("episode_label").notNull(),
  status: text("status").notNull().default("collecting"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  originalName: text("original_name").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  classification: text("classification").notNull(),
  classificationConfidence: integer("classification_confidence").notNull(),
  pageFrom: integer("page_from"),
  pageTo: integer("page_to"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_documents_case_id").on(table.caseId)]);

export const extractedFields = sqliteTable("extracted_fields", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id),
  fieldKey: text("field_key").notNull(),
  fieldValue: text("field_value").notNull(),
  sourcePage: integer("source_page").notNull(),
  sourceRegion: text("source_region"),
  confidence: integer("confidence").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_extracted_fields_document_id").on(table.documentId)]);

export const documentExtractions = sqliteTable("document_extractions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().unique().references(() => documents.id),
  extractionJson: text("extraction_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const caseAnalyses = sqliteTable("case_analyses", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().unique().references(() => cases.id),
  analysisJson: text("analysis_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const claimAuthorizations = sqliteTable("claim_authorizations", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().unique().references(() => cases.id),
  authorized: integer("authorized").notNull().default(0),
  scope: text("scope").notNull(),
  authorizedAt: text("authorized_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const caseActivities = sqliteTable("case_activities", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  eventAt: text("event_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  pending: integer("pending").notNull().default(0),
}, (table) => [index("idx_case_activities_case_id").on(table.caseId, table.eventAt)]);
