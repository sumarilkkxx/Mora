-- Projects created before production_mode existed defaulted to local during the
-- schema migration. A persisted billable video task is strong evidence that the
-- project's primary historical flow was AI video; image-only assistance is not.
UPDATE `projects`
SET `production_mode` = 'ai'
WHERE `production_mode` = 'local'
  AND EXISTS (
    SELECT 1
    FROM `ai_tasks`
    WHERE `ai_tasks`.`project_id` = `projects`.`id`
      AND `ai_tasks`.`media_type` = 'video'
  );
