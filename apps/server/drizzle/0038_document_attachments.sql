ALTER TABLE `session_attachments` ADD `filename` text DEFAULT 'screenshot' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `kind` text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `storage_path` text;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `method` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `page_count` integer;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `token_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `sections_json` text;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `warnings_json` text;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `extractor_id` text;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `extractor_version` text;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `extracted_at` integer;--> statement-breakpoint
ALTER TABLE `session_attachments` ADD `error_code` text;--> statement-breakpoint
UPDATE `session_attachments` SET `size_bytes` = length(`bytes`) WHERE `size_bytes` = 0;--> statement-breakpoint
CREATE INDEX `idx_session_attachments_session_created` ON `session_attachments` (`session_id`,`created_at`);