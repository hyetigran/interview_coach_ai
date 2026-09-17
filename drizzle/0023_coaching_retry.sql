ALTER TABLE coaching_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN draft_attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN reuse_draft TEXT;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN recovery_action_id TEXT;
--> statement-breakpoint
DROP INDEX coaching_input_context;
--> statement-breakpoint
CREATE UNIQUE INDEX coaching_input_context_grouping ON coaching_runs(review_id,revision,context_revision,grouping_version);
