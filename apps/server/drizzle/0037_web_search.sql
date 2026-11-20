CREATE TABLE `web_search_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`region` text,
	`endpoint` text NOT NULL,
	`secret_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`secret_ref`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_web_search_connections_provider` ON `web_search_connections` (`provider`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `web_search_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `web_search_enabled` integer DEFAULT false NOT NULL;