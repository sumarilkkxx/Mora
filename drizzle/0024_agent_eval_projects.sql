ALTER TABLE projects ADD COLUMN is_evaluation integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE projects SET is_evaluation = 1 WHERE name LIKE '[Eval] %';
