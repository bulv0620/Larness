CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_session_id` text,
	`terminal_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`terminal_execution_id` text NOT NULL,
	`endpoint_generation` integer NOT NULL,
	`endpoint_host` text NOT NULL,
	`endpoint_port` integer NOT NULL,
	`endpoint_protocol` text NOT NULL,
	`identity_json` text NOT NULL,
	`reason_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`operation_id`) REFERENCES `resource_operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "services_status" CHECK("services"."status" IN ('REGISTERING', 'STARTING', 'RUNNING', 'UNKNOWN', 'UNREGISTERED')),
	CONSTRAINT "services_host" CHECK("services"."endpoint_host" IN ('127.0.0.1', '::1')),
	CONSTRAINT "services_port" CHECK("services"."endpoint_port" BETWEEN 1 AND 65535),
	CONSTRAINT "services_protocol" CHECK("services"."endpoint_protocol" = 'http')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_operation` ON `services` (`operation_id`);--> statement-breakpoint
CREATE INDEX `services_project_status` ON `services` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `services_terminal` ON `services` (`terminal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `services_active_endpoint` ON `services` (`terminal_id`,`endpoint_host`,`endpoint_port`) WHERE "services"."status" IN ('REGISTERING', 'STARTING', 'RUNNING');