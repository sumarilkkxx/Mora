CREATE TABLE `auto_edit_runs` (
 `id` text PRIMARY KEY NOT NULL,
 `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
 `source_id` text NOT NULL REFERENCES `media_sources`(`id`) ON DELETE CASCADE,
 `request_key` text NOT NULL UNIQUE,
 `parent_id` text,
 `status` text NOT NULL DEFAULT 'queued',
 `stage` text NOT NULL DEFAULT 'queued',
 `brief` text NOT NULL,
 `checkpoint` text NOT NULL,
 `quality` text NOT NULL DEFAULT '720p',
 `owner` text,
 `heartbeat` integer NOT NULL,
 `attempt` integer NOT NULL DEFAULT 0,
 `error` text,
 `composition_id` text REFERENCES `compositions`(`id`) ON DELETE SET NULL,
 `created_at` integer NOT NULL,
 `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auto_edit_project` ON `auto_edit_runs` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `auto_edit_analysis` (
 `cache_key` text PRIMARY KEY NOT NULL,
 `source_id` text NOT NULL REFERENCES `media_sources`(`id`) ON DELETE CASCADE,
 `document` text NOT NULL,
 `created_at` integer NOT NULL
);
