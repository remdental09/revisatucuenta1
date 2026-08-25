CREATE TABLE IF NOT EXISTS `corpus_contributions` (
	`case_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`contribution_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
