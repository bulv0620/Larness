CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`project_key` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence_kind` text NOT NULL,
	`source_turn_id` text,
	`source_event_seq` integer,
	`created_by` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`last_confirmed_at` integer,
	`correction_count` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`bytes` integer NOT NULL,
	`verified_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memories_scope_check" CHECK(("memories"."scope" = 'global' AND "memories"."project_id" IS NULL AND "memories"."kind" = 'preference') OR ("memories"."scope" = 'project' AND "memories"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_active_key_unique` ON `memories` (`scope`,`project_key`,`key`) WHERE "memories"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_memories_scope_project_status` ON `memories` (`scope`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memories_expires` ON `memories` (`expires_at`);--> statement-breakpoint
CREATE TABLE `memory_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` integer NOT NULL,
	`reason` text,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_revisions_unique` ON `memory_revisions` (`memory_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_memory_revisions_memory` ON `memory_revisions` (`memory_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `memory_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`project_key` text NOT NULL,
	`key` text NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_suppressions_scope_check" CHECK(("memory_suppressions"."scope" = 'global' AND "memory_suppressions"."project_id" IS NULL) OR ("memory_suppressions"."scope" = 'project' AND "memory_suppressions"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_suppressions_key_unique` ON `memory_suppressions` (`scope`,`project_key`,`key`);--> statement-breakpoint
CREATE INDEX `idx_memory_suppressions_expiry` ON `memory_suppressions` (`expires_at`);