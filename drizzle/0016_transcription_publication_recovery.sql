ALTER TABLE transcriptions ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE transcriptions ADD COLUMN publication_deadline INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE transcriptions ADD COLUMN publication_checked_at INTEGER NOT NULL DEFAULT 0;
