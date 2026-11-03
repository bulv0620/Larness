CREATE TABLE `command_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text,
	`workspace_session_id` text,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`params_hash` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`reason_code` text,
	`truncated` integer DEFAULT false NOT NULL,
	`process_identity_json` text,
	`output_cursor` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`operation_id`) REFERENCES `resource_operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_executions_operation` ON `command_executions` (`operation_id`);--> statement-breakpoint
CREATE INDEX `command_executions_status` ON `command_executions` (`status`);