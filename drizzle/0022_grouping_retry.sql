ALTER TABLE grouping_chunks ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN input_payload TEXT;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN reuse_result TEXT;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN reuse_input TEXT;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN recovery_action_id TEXT;
--> statement-breakpoint
ALTER TABLE grouping_runs ADD COLUMN recovery_action_id TEXT;
--> statement-breakpoint
ALTER TABLE recovery_requests ADD COLUMN plan TEXT;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE grouping_chunks SET submitted=1 WHERE state IN ('submitting','unknown','reconciliation','reconciliation_exhausted','publishing') OR EXISTS(SELECT 1 FROM processing_budget WHERE processing_budget.id=grouping_chunks.id);
