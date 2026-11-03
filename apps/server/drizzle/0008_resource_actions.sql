CREATE TABLE `resource_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`params_json` text NOT NULL,
	`params_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`started_at` integer,
	`ended_at` integer,
	`result_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `resource_operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_actions_operation` ON `resource_actions` (`operation_id`);--> statement-breakpoint
CREATE INDEX `resource_actions_project_status` ON `resource_actions` (`project_id`,`status`);