ALTER TABLE projects ADD COLUMN workflow_mode text;
--> statement-breakpoint
UPDATE projects
SET workflow_mode = CASE
  WHEN EXISTS (SELECT 1 FROM auto_edit_runs WHERE auto_edit_runs.project_id = projects.id) THEN 'auto_edit'
  WHEN EXISTS (SELECT 1 FROM guided_edit_plans WHERE guided_edit_plans.project_id = projects.id) THEN 'guided_edit'
  WHEN EXISTS (SELECT 1 FROM media_edits WHERE media_edits.project_id = projects.id) THEN 'transcript_edit'
  WHEN workflow_type = 'edit' THEN 'guided_edit'
  WHEN production_mode = 'ai' THEN 'cloud_generate'
  ELSE 'local_generate'
END;
