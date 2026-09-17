ALTER TABLE grouping_chunks ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN publication_deadline INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE grouping_chunks ADD COLUMN publication_checked_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_runs ADD COLUMN grouping_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE coaching_runs SET grouping_version=COALESCE((SELECT output_version FROM grouping_runs WHERE grouping_runs.id=coaching_runs.grouping_id),0);
