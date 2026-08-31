CREATE TABLE IF NOT EXISTS `service_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`contract_version` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`patient_name` text NOT NULL,
	`patient_email` text NOT NULL,
	`company_name` text NOT NULL,
	`episode_label` text NOT NULL,
	`contract_text` text NOT NULL,
	`price_clp` integer DEFAULT 0 NOT NULL,
	`accepted_terms` integer DEFAULT 0 NOT NULL,
	`data_consent` integer DEFAULT 0 NOT NULL,
	`mandate_consent` integer DEFAULT 0 NOT NULL,
	`signer_name` text,
	`accepted_at` text,
	`payment_status` text DEFAULT 'not_started' NOT NULL,
	`payment_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_contracts_case_id_unique` ON `service_contracts` (`case_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_contracts_case_id` ON `service_contracts` (`case_id`);
