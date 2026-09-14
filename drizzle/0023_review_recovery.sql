ALTER TABLE compositions ADD COLUMN completed_at integer;
--> statement-breakpoint
UPDATE compositions SET completed_at = created_at * 1000 WHERE status = 'done';
--> statement-breakpoint
CREATE TRIGGER compositions_completed_insert AFTER INSERT ON compositions
WHEN NEW.status = 'done' AND NEW.completed_at IS NULL
BEGIN
  UPDATE compositions SET completed_at = CAST(strftime('%s', 'now') AS integer) * 1000 + CAST(substr(strftime('%f', 'now'), 4) AS integer) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER compositions_completed_update AFTER UPDATE OF status ON compositions
WHEN NEW.status = 'done' AND OLD.status <> 'done'
BEGIN
  UPDATE compositions SET completed_at = CAST(strftime('%s', 'now') AS integer) * 1000 + CAST(substr(strftime('%f', 'now'), 4) AS integer) WHERE id = NEW.id;
END;
--> statement-breakpoint
ALTER TABLE batch_jobs ADD COLUMN execution_owner text;
--> statement-breakpoint
ALTER TABLE batch_jobs ADD COLUMN execution_until integer;

--> statement-breakpoint
ALTER TABLE batch_job_items ADD COLUMN script_id text;
