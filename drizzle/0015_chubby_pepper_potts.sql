CREATE TABLE `guided_edit_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`composition_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composition_id`) REFERENCES `compositions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `media_sources` ADD `scene_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_sources` ADD `scenes` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `projects` ADD `workflow_type` text DEFAULT 'generate' NOT NULL;