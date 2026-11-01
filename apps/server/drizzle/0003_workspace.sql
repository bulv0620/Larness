CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_session_seq_unique` ON `agent_events` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`risk` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scope_json` text DEFAULT '{}' NOT NULL,
	`params_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_approvals_turn_status` ON `approvals` (`turn_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approvals_expiry` ON `approvals` (`expires_at`);--> statement-breakpoint
CREATE TABLE `resource_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`owner` text NOT NULL,
	`execution_id` text NOT NULL,
	`fencing_token` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_locks_resource_unique` ON `resource_locks` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_locks_expiry` ON `resource_locks` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`workspace_path` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`model_profile_id` text,
	`approval_policy_id` text DEFAULT 'standard' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_project_updated` ON `sessions` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_updated` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`model_profile_id` text,
	`provider` text,
	`model` text,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`usage_json` text,
	`error_json` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_session_idempotency_unique` ON `turns` (`session_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_turns_session_created` ON `turns` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_turns_session_status` ON `turns` (`session_id`,`status`);