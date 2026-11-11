ALTER TABLE `session_context_summaries` ADD `scope` text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_context_summaries` ADD `turn_id` text;--> statement-breakpoint
ALTER TABLE `session_context_summaries` ADD `reason` text;--> statement-breakpoint
CREATE INDEX `idx_summaries_session_scope_created` ON `session_context_summaries` (`session_id`,`scope`,`created_at`);