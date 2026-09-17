ALTER TABLE coaching_jobs ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN publication_deadline INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN publication_checked_at INTEGER NOT NULL DEFAULT 0;
