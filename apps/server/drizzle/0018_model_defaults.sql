CREATE TABLE `model_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_profile_id` text NOT NULL,
	`model` text NOT NULL,
	`thinking` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`credential_profile_id`) REFERENCES `credential_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "model_defaults_single_row" CHECK("model_defaults"."id" = 'default')
);
