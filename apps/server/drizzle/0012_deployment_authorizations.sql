CREATE TABLE `deployment_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
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
	`plan_hash` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`scope_json` text NOT NULL,
	`scope_hash` text NOT NULL,
	`approval_id` text,
	`request_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`consumed_at` integer,
	`consume_key` text,
	`reason_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `deployment_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_authorizations_action" CHECK(`deployment_authorizations`.`action` = 'apply'),
	CONSTRAINT "deployment_authorizations_actor" CHECK(`deployment_authorizations`.`actor_type` IN ('human', 'agent')),
	CONSTRAINT "deployment_authorizations_policy" CHECK(`deployment_authorizations`.`policy` IN ('standard', 'strict', 'readonly', 'autonomous')),
	CONSTRAINT "deployment_authorizations_status" CHECK(`deployment_authorizations`.`status` IN ('PENDING', 'AUTHORIZED', 'DENIED', 'EXPIRED', 'REVOKED', 'CONSUMED', 'INVALIDATED')),
	CONSTRAINT "deployment_authorizations_plan_hash" CHECK(length(`deployment_authorizations`.`plan_hash`) = 64),
	CONSTRAINT "deployment_authorizations_artifact_hash" CHECK(length(`deployment_authorizations`.`artifact_hash`) = 64),
	CONSTRAINT "deployment_authorizations_scope_hash" CHECK(length(`deployment_authorizations`.`scope_hash`) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_authorizations_request` ON `deployment_authorizations` (`request_key`);--> statement-breakpoint
CREATE INDEX `deployment_authorizations_plan_status` ON `deployment_authorizations` (`plan_id`,`status`);--> statement-breakpoint
CREATE INDEX `deployment_authorizations_target_status` ON `deployment_authorizations` (`target_id`,`status`);--> statement-breakpoint
CREATE INDEX `deployment_authorizations_status_expires` ON `deployment_authorizations` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `deployment_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`authorization_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`target_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`plan_hash` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`requested_by` text NOT NULL,
	`decided_by` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`authorization_id`) REFERENCES `deployment_authorizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `deployment_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `deployment_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deployment_approvals_status" CHECK(`deployment_approvals`.`status` IN ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED')),
	CONSTRAINT "deployment_approvals_plan_hash" CHECK(length(`deployment_approvals`.`plan_hash`) = 64),
	CONSTRAINT "deployment_approvals_artifact_hash" CHECK(length(`deployment_approvals`.`artifact_hash`) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_approvals_authorization` ON `deployment_approvals` (`authorization_id`);--> statement-breakpoint
CREATE INDEX `deployment_approvals_status_expires` ON `deployment_approvals` (`status`,`expires_at`);
