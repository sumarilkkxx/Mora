CREATE TABLE `ad_template_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe` text NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL,
	`created_at` integer
);
