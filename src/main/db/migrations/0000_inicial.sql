CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_unique` ON `clients` (lower("name"));--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`deployment` text NOT NULL,
	`classic_api_url` text,
	`platform_url` text,
	`sso_url` text,
	`oauth_client_id` text,
	`oauth_scopes` text NOT NULL,
	`account_uuid` text,
	`certificate_level` text NOT NULL,
	`capture_url_patterns` text NOT NULL,
	`tags` text NOT NULL,
	`read_only` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_client_name_unique` ON `environments` (`client_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `secrets` (
	`environment_id` text NOT NULL,
	`kind` text NOT NULL,
	`ciphertext` blob NOT NULL,
	PRIMARY KEY(`environment_id`, `kind`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
