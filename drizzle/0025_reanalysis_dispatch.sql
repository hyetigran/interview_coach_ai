ALTER TABLE coaching_runs ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_runs ADD COLUMN dispatch_started_at INTEGER NOT NULL DEFAULT 0;
