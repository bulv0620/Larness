CREATE TABLE `credential_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`secret_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`secret_ref`) REFERENCES `secrets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_credential_profiles_provider` ON `credential_profiles` (`provider`);--> statement-breakpoint
CREATE TABLE `model_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`credential_profile_id` text,
	`endpoint` text,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`credential_profile_id`) REFERENCES `credential_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_model_profiles_provider` ON `model_profiles` (`provider`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL
);
