CREATE TABLE IF NOT EXISTS `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`shot_id` integer NOT NULL,
	`type` text NOT NULL,
	`file_path` text,
	`thumbnail_path` text,
	`provider` text,
	`model` text,
	`prompt` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brand_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo_path` text,
	`primary_color` text,
	`secondary_color` text,
	`font_family` text,
	`watermark` text,
	`intro_template_path` text,
	`outro_template_path` text,
	`is_default` integer DEFAULT true,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`appearance` text,
	`reference_images` text DEFAULT '[]',
	`voice_profile` text,
	`is_default` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `compositions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`output_path` text,
	`resolution` text DEFAULT '1080p',
	`aspect_ratio` text DEFAULT '9:16',
	`duration` integer,
	`bgm_path` text,
	`tts_enabled` integer DEFAULT false,
	`subtitle_style` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`images` text DEFAULT '[]',
	`price` text,
	`target_audience` text,
	`analysis` text,
	`video_count` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`product_name` text,
	`product_category` text,
	`product_description` text,
	`product_images` text DEFAULT '[]',
	`product_analysis` text,
	`product_id` text,
	`brand_id` text,
	`template_id` text,
	`video_mode` text DEFAULT 'product_closeup',
	`source_type` text DEFAULT 'manual',
	`source_video_url` text,
	`character_id` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `script_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`video_mode` text,
	`style_type` text,
	`shots` text DEFAULT '[]',
	`source_project_id` text,
	`use_count` integer DEFAULT 0,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`style_type` text NOT NULL,
	`title` text,
	`total_duration` integer,
	`shots` text DEFAULT '[]',
	`selected` integer DEFAULT false,
	`created_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `video_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`shot_id` integer NOT NULL,
	`asset_id` text,
	`file_path` text,
	`duration` integer,
	`provider` text,
	`model` text,
	`transition_type` text DEFAULT 'ai_start_end',
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
