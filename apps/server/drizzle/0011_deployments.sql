CREATE TABLE `deployment_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`current_artifact_id` text,
	`current_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_targets_current" CHECK((`deployment_targets`.`current_artifact_id` IS NULL) = (`deployment_targets`.`current_version` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_targets_project_name` ON `deployment_targets` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `deployment_targets_project_updated` ON `deployment_targets` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `deployment_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`request_key` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`spec_json` text NOT NULL,
	`spec_hash` text NOT NULL,
	`reason_code` text,
	`log_ref` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_builds_status" CHECK(`deployment_builds`.`status` IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_builds_request` ON `deployment_builds` (`request_key`);--> statement-breakpoint
CREATE INDEX `deployment_builds_target_created` ON `deployment_builds` (`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployment_builds_status` ON `deployment_builds` (`status`);--> statement-breakpoint
CREATE TABLE `deployment_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`artifact_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_count` integer NOT NULL,
	`spec_json` text NOT NULL,
	`spec_hash` text NOT NULL,
	`source_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `deployment_builds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_artifacts_hash" CHECK(length(`deployment_artifacts`.`artifact_hash`) = 64),
	CONSTRAINT "deployment_artifacts_size" CHECK(`deployment_artifacts`.`size_bytes` >= 0),
	CONSTRAINT "deployment_artifacts_count" CHECK(`deployment_artifacts`.`file_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_artifacts_build` ON `deployment_artifacts` (`build_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_artifacts_target_version` ON `deployment_artifacts` (`target_id`,`version`);--> statement-breakpoint
CREATE INDEX `deployment_artifacts_target_created` ON `deployment_artifacts` (`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deployment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`previous_artifact_id` text,
	`previous_version` text,
	`version` text NOT NULL,
	`plan_json` text NOT NULL,
	`plan_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`request_key` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `deployment_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_artifact_id`) REFERENCES `deployment_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_plans_status" CHECK(`deployment_plans`.`status` IN ('READY', 'WAITING_APPROVAL', 'AUTHORIZED', 'APPLYING', 'HEALTH_CHECK', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'INVALIDATED', 'UNKNOWN')),
	CONSTRAINT "deployment_plans_hash" CHECK(length(`deployment_plans`.`plan_hash`) = 64),
	CONSTRAINT "deployment_plans_previous" CHECK((`deployment_plans`.`previous_artifact_id` IS NULL) = (`deployment_plans`.`previous_version` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_plans_request` ON `deployment_plans` (`request_key`);--> statement-breakpoint
CREATE INDEX `deployment_plans_target_created` ON `deployment_plans` (`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployment_plans_status_expires` ON `deployment_plans` (`status`,`expires_at`);
