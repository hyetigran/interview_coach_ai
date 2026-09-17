CREATE TABLE recovery_requests (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 stage TEXT NOT NULL, target_id TEXT NOT NULL, input_revision INTEGER NOT NULL,
 context_revision INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE speaker_confirmations ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 1;
