CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`real_path` text NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`git_detected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_real_path_unique` ON `projects` (`real_path`);--> statement-breakpoint
CREATE INDEX `idx_projects_updated` ON `projects` (`updated_at`);