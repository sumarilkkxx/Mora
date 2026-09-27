ALTER TABLE brand_settings ADD COLUMN intro_enabled integer DEFAULT false;
--> statement-breakpoint
ALTER TABLE brand_settings ADD COLUMN outro_enabled integer DEFAULT false;
--> statement-breakpoint
ALTER TABLE brand_settings ADD COLUMN outro_text text;
--> statement-breakpoint
ALTER TABLE script_templates ADD COLUMN total_duration integer;
