CREATE TABLE `model_visibility` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_profile_id` text NOT NULL,
	`model_id` text NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`credential_profile_id`) REFERENCES `credential_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_visibility_credential_model` ON `model_visibility` (`credential_profile_id`,`model_id`);