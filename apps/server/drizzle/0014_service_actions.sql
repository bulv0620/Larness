CREATE TABLE `service_action_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`client_session_id` text,
	`session_id` text,
	`turn_id` text,
	`policy` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`status` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`version` text NOT NULL,
	`scope_json` text NOT NULL,
	`scope_hash` text NOT NULL,
	`request_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`consumed_at` integer,
	`consume_key` text,
	`reason_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_action_authorizations_action" CHECK(`service_action_authorizations`.`action` IN ('start', 'stop', 'restart', 'recover')),
	CONSTRAINT "service_action_authorizations_status" CHECK(`service_action_authorizations`.`status` IN ('PENDING', 'AUTHORIZED', 'DENIED', 'EXPIRED', 'REVOKED', 'CONSUMED')),
	CONSTRAINT "service_action_authorizations_artifact_hash" CHECK(length(`service_action_authorizations`.`artifact_hash`) = 64),
	CONSTRAINT "service_action_authorizations_scope_hash" CHECK(length(`service_action_authorizations`.`scope_hash`) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_action_authorizations_request` ON `service_action_authorizations` (`request_key`);--> statement-breakpoint
CREATE INDEX `service_action_authorizations_target_status` ON `service_action_authorizations` (`target_id`,`status`);--> statement-breakpoint
CREATE INDEX `service_action_authorizations_status_expires` ON `service_action_authorizations` (`status`,`expires_at`);
