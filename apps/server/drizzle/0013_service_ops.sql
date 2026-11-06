CREATE TABLE `service_ops_services` (
	`target_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`namespace` text NOT NULL,
	`pm2_name` text NOT NULL,
	`desired_state` text NOT NULL,
	`observed_state` text NOT NULL,
	`current_artifact_id` text,
	`current_version` text,
	`config_json` text NOT NULL,
	`pid` integer,
	`last_health_at` integer,
	`reason_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_artifact_id`) REFERENCES `deployment_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_ops_services_desired" CHECK(`service_ops_services`.`desired_state` IN ('running', 'stopped')),
	CONSTRAINT "service_ops_services_observed" CHECK(`service_ops_services`.`observed_state` IN ('stopped', 'starting', 'running', 'unhealthy', 'stopping', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_ops_services_pm2_name` ON `service_ops_services` (`pm2_name`);--> statement-breakpoint
CREATE INDEX `service_ops_services_project` ON `service_ops_services` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `service_ops_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`previous_artifact_id` text,
	`previous_version` text,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`plan_hash` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`policy` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`reason_code` text,
	`health_json` text,
	`result_json` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `deployment_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorization_id`) REFERENCES `deployment_authorizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `deployment_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_artifact_id`) REFERENCES `deployment_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_ops_deployments_status" CHECK(`service_ops_deployments`.`status` IN ('APPLYING', 'HEALTH_CHECK', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
	CONSTRAINT "service_ops_deployments_plan_hash" CHECK(length(`service_ops_deployments`.`plan_hash`) = 64),
	CONSTRAINT "service_ops_deployments_artifact_hash" CHECK(length(`service_ops_deployments`.`artifact_hash`) = 64),
	CONSTRAINT "service_ops_deployments_previous" CHECK((`service_ops_deployments`.`previous_artifact_id` IS NULL) = (`service_ops_deployments`.`previous_version` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_ops_deployments_plan` ON `service_ops_deployments` (`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_ops_deployments_authorization` ON `service_ops_deployments` (`authorization_id`);--> statement-breakpoint
CREATE INDEX `service_ops_deployments_target_created` ON `service_ops_deployments` (`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `service_ops_deployments_status` ON `service_ops_deployments` (`status`);
