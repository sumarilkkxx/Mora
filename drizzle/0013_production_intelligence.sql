ALTER TABLE `projects` ADD `creative_intent` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `visual_bible` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `media_insights` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `projects` ADD `production_workflow` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `version_snapshots` text DEFAULT '[]';