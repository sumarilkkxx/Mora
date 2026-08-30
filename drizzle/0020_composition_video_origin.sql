ALTER TABLE `compositions` ADD `video_origin` text DEFAULT 'local_render' NOT NULL;--> statement-breakpoint

-- Only the final video generator decides workflow classification. Historical
-- cloud outputs have stable filenames/labels; every other composition was made
-- by a local FFmpeg/editing renderer and keeps the local_render default.
UPDATE `compositions`
SET `video_origin` = 'cloud_ai'
WHERE lower(COALESCE(`output_path`, '')) LIKE '%\cloud_%'
   OR lower(COALESCE(`output_path`, '')) LIKE '%/cloud_%'
   OR lower(COALESCE(`output_path`, '')) LIKE '%\film_%'
   OR lower(COALESCE(`output_path`, '')) LIKE '%/film_%'
   OR lower(COALESCE(`output_path`, '')) LIKE '%\replicate_%'
   OR lower(COALESCE(`output_path`, '')) LIKE '%/replicate_%'
   OR COALESCE(`label`, '') LIKE '云端生成 · %'
   OR COALESCE(`label`, '') LIKE '九宫格整片 · %';--> statement-breakpoint

-- Repair existing projects using their newest non-failed final-video job. This
-- fixes mixed projects where AI images feed a newer local final composition.
UPDATE `projects`
SET `production_mode` = CASE (
  SELECT `video_origin`
  FROM `compositions`
  WHERE `compositions`.`project_id` = `projects`.`id`
    AND `compositions`.`status` <> 'failed'
  ORDER BY `compositions`.`created_at` DESC
  LIMIT 1
)
  WHEN 'cloud_ai' THEN 'ai'
  WHEN 'local_render' THEN 'local'
  ELSE `production_mode`
END
WHERE EXISTS (
  SELECT 1
  FROM `compositions`
  WHERE `compositions`.`project_id` = `projects`.`id`
    AND `compositions`.`status` <> 'failed'
);
