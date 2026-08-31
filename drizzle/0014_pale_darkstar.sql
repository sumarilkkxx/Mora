CREATE TABLE `media_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`plan` text NOT NULL,
	`keep_ranges` text NOT NULL,
	`composition_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composition_id`) REFERENCES `compositions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`original_name` text NOT NULL,
	`file_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`has_audio` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`model` text,
	`device` text,
	`language` text,
	`transcript` text,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
