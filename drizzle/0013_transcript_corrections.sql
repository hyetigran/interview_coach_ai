ALTER TABLE transcriptions ADD COLUMN parent_id TEXT;
--> statement-breakpoint
ALTER TABLE transcriptions ADD COLUMN corrected_utterance_id TEXT;
--> statement-breakpoint
CREATE TABLE transcript_correction_intents (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 parent_id TEXT NOT NULL, revision INTEGER NOT NULL, result_key TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'preparing', created_at INTEGER NOT NULL,
 reuse_grouping_id TEXT, reuse_prefix INTEGER NOT NULL DEFAULT 0
);
