CREATE TABLE `scheduled_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`duration_ms` integer,
	`session_id` text,
	`turn_id` text,
	`exit_code` integer,
	`output` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scheduled_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_job_runs_job` ON `scheduled_job_runs` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_job_runs_status` ON `scheduled_job_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`schedule_type` text NOT NULL,
	`cron_expression` text,
	`interval_seconds` integer,
	`timezone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`overlap_policy` text DEFAULT 'skip' NOT NULL,
	`missed_policy` text DEFAULT 'skip' NOT NULL,
	`timeout_seconds` integer DEFAULT 600 NOT NULL,
	`script_source` text,
	`agent_prompt` text,
	`agent_model` text,
	`agent_credential_profile_id` text,
	`agent_thinking` text,
	`agent_approval_policy` text,
	`session_id` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_credential_profile_id`) REFERENCES `credential_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_jobs_due` ON `scheduled_jobs` (`enabled`,`archived_at`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_jobs_project` ON `scheduled_jobs` (`project_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sessions_origin` ON `sessions` (`origin`,`updated_at`);