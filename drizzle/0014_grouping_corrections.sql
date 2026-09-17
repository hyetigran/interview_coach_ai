ALTER TABLE transcript_correction_intents ADD COLUMN candidate_speakers TEXT;
--> statement-breakpoint
ALTER TABLE transcript_correction_intents ADD COLUMN manual_groups TEXT;
--> statement-breakpoint
ALTER TABLE transcript_correction_intents ADD COLUMN coverage TEXT;
--> statement-breakpoint
ALTER TABLE grouping_runs ADD COLUMN output_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER grouping_output_version AFTER UPDATE OF result ON grouping_chunks
WHEN OLD.result IS NOT NEW.result
BEGIN
 UPDATE grouping_runs SET output_version=output_version+1 WHERE id=NEW.run_id;
END;
