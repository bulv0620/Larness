CREATE TABLE `terminal_leases` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`owner_type` text,
	`owner_client_session_id` text,
	`owner_connection_id` text,
	`owner_session_id` text,
	`owner_turn_id` text,
	`owner_execution_id` text,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`heartbeat_at` integer DEFAULT 0 NOT NULL,
	`input_sequence` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text,
	`workspace_session_id` text,
	`source_session_id` text,
	`cwd` text NOT NULL,
	`shell` text NOT NULL,
	`mode` text NOT NULL,
	`role` text,
	`launch_params_json` text,
	`launch_params_hash` text,
	`created_by_turn_id` text,
	`status` text NOT NULL,
	`process_identity_json` text,
	`reason_code` text,
	`output_cursor` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`exit_code` integer,
	FOREIGN KEY (`operation_id`) REFERENCES `resource_operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminals_operation` ON `terminals` (`operation_id`);--> statement-breakpoint
CREATE INDEX `terminals_status` ON `terminals` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `terminals_active_role` ON `terminals` (`project_id`,`role`) WHERE "terminals"."mode" = 'dev' AND "terminals"."status" IN ('CREATED', 'RUNNING', 'STOPPING');