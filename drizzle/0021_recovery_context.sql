ALTER TABLE ai_tasks ADD COLUMN keyframe_path text;
--> statement-breakpoint
ALTER TABLE compositions ADD COLUMN render_owner text;
--> statement-breakpoint
ALTER TABLE compositions ADD COLUMN render_heartbeat integer;
