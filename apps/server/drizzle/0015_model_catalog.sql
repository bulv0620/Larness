-- M5-1a: official model catalog cache and per-turn model snapshots.
-- Only additive; existing model_profiles / credential_profiles rows are preserved.
CREATE TABLE `model_catalog_cache` (
	`credential_profile_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`synced_at` integer,
	`last_attempt_at` integer,
	`last_error_code` text,
	FOREIGN KEY (`credential_profile_id`) REFERENCES `credential_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `model` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `thinking` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `thinking` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `context_window` integer;
