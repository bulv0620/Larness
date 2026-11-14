ALTER TABLE `credential_profiles` ADD `capability_overrides_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `max_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `turns` ADD `max_output_tokens` integer;