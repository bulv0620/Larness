CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_session_id` text,
	`session_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`decision` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`admin_hash` text NOT NULL,
	`admin_updated_at` integer NOT NULL,
	`initialized_at` integer NOT NULL,
	CONSTRAINT "auth_settings_single_row" CHECK("auth_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `browser_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `trusted_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_sessions_token_hash_unique` ON `browser_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_browser_sessions_device` ON `browser_sessions` (`device_id`);--> statement-breakpoint
CREATE TABLE `device_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`short_code` text NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`client_label` text,
	`user_agent` text,
	`ip` text,
	`client_origin` text,
	`poll_token_hash` text NOT NULL,
	`code_hash` text,
	`code_expires_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`enrollment_token_hash` text,
	`enrollment_expires_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`redeemed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_requests_short_code_unique` ON `device_requests` (`short_code`);--> statement-breakpoint
CREATE INDEX `idx_device_requests_status` ON `device_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`created_by_request_id` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`created_by_request_id`) REFERENCES `device_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`challenge` text NOT NULL,
	`request_id` text,
	`device_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `device_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `trusted_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_webauthn_challenges_expiry` ON `webauthn_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports_json` text DEFAULT '[]' NOT NULL,
	`aaguid` text,
	`backup_eligible` integer DEFAULT false NOT NULL,
	`backup_state` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `trusted_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_credential_id_unique` ON `webauthn_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_webauthn_credentials_device` ON `webauthn_credentials` (`device_id`);