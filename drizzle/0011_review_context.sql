ALTER TABLE reviews ADD COLUMN coaching_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE speaker_confirmations ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE coaching_runs ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE coaching_runs ADD COLUMN grouping_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE coaching_runs ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'sent';
--> statement-breakpoint
UPDATE coaching_runs SET grouping_id=id;
--> statement-breakpoint
CREATE TABLE review_context_versions (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(review_id,revision)
);
--> statement-breakpoint
CREATE UNIQUE INDEX coaching_input_context ON coaching_runs(review_id,revision,context_revision);
