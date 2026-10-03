CREATE TABLE `certificate_pins` (
	`environment_id` text NOT NULL,
	`host` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`environment_id`, `host`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
