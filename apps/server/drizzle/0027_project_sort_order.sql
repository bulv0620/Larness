ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_projects_order` ON `projects` (`sort_order`,`updated_at`);