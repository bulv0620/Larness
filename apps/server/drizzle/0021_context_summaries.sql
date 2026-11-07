CREATE TABLE `session_context_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`covered_up_to_seq` integer NOT NULL,
	`summary` text NOT NULL,
	`tokens_before` integer NOT NULL,
	`tokens_after` integer NOT NULL,
	`degraded` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_context_summaries_session` ON `session_context_summaries` (`session_id`,`created_at`);