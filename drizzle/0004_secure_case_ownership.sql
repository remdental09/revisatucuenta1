ALTER TABLE `cases` ADD `owner_user_id` text DEFAULT '' NOT NULL;
ALTER TABLE `cases` ADD `owner_email` text DEFAULT '' NOT NULL;
ALTER TABLE `cases` ADD `contact_email` text DEFAULT '' NOT NULL;
ALTER TABLE `documents` ADD `processing_status` text DEFAULT 'uploaded' NOT NULL;
ALTER TABLE `documents` ADD `processing_error` text;
ALTER TABLE `documents` ADD `source_expires_at` text;
ALTER TABLE `documents` ADD `source_deleted_at` text;
ALTER TABLE `extracted_fields` ADD `source_text` text;
CREATE INDEX `idx_cases_owner_updated` ON `cases` (`owner_user_id`,`updated_at`);
