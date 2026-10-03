CREATE TABLE `saved_metric_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`metric_selector` text NOT NULL,
	`resolution` text,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
