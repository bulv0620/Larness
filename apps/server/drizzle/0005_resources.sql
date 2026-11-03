CREATE TABLE `file_versions` (
	`scope_key` text NOT NULL,
	`path` text NOT NULL,
	`real_path` text NOT NULL,
	`version_hash` text NOT NULL,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_versions_scope_path` ON `file_versions` (`scope_key`,`path`);--> statement-breakpoint
CREATE TABLE `resource_events` (
	`id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`stream_id`) REFERENCES `resource_streams`(`stream_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_events_stream_seq` ON `resource_events` (`stream_id`,`seq`);--> statement-breakpoint
CREATE TABLE `resource_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`root_real_path` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`params_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`client_session_id` text NOT NULL,
	`path` text NOT NULL,
	`expected_version` text NOT NULL,
	`target_version` text NOT NULL,
	`lock_id` text NOT NULL,
	`fencing_token` integer NOT NULL,
	`result_json` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_operations_client_kind_key` ON `resource_operations` (`client_session_id`,`kind`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `resource_operations_status` ON `resource_operations` (`status`);--> statement-breakpoint
CREATE TABLE `resource_streams` (
	`stream_id` text PRIMARY KEY NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `resource_locks` ADD `root_real_path` text;
--> statement-breakpoint
UPDATE `resource_locks` SET `root_real_path` = (
  SELECT `real_path` FROM `projects` WHERE `projects`.`id` = `resource_locks`.`resource_id`
) WHERE `resource_type` = 'project';
