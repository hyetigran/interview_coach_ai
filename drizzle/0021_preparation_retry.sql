ALTER TABLE processing_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN failure_kind TEXT NOT NULL DEFAULT 'retryable';
--> statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN recovery_action_id TEXT;
--> statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN dispatch_started_at INTEGER NOT NULL DEFAULT 0;
