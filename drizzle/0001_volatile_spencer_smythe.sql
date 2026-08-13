CREATE INDEX `idx_documents_case_id` ON `documents` (`case_id`);--> statement-breakpoint
CREATE INDEX `idx_extracted_fields_document_id` ON `extracted_fields` (`document_id`);