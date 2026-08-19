CREATE TABLE IF NOT EXISTS `document_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`extraction_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `document_extractions_document_id_unique` ON `document_extractions` (`document_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`analysis_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `case_analyses_case_id_unique` ON `case_analyses` (`case_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `claim_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`authorized` integer DEFAULT 0 NOT NULL,
	`scope` text NOT NULL,
	`authorized_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `claim_authorizations_case_id_unique` ON `claim_authorizations` (`case_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`event_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_case_activities_case_id` ON `case_activities` (`case_id`,`event_at`);
