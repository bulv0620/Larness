ALTER TABLE `credential_profiles` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `connection_revision` integer;--> statement-breakpoint
ALTER TABLE `turns` ADD `connection_endpoint` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `connection_secret_ref` text;