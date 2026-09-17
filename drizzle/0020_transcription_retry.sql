ALTER TABLE transcriptions ADD COLUMN paid_attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE transcriptions ADD COLUMN recovery_action_id TEXT;
--> statement-breakpoint
ALTER TABLE recovery_requests ADD COLUMN target_attempt INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE recovery_requests ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE recovery_requests ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE recovery_requests ADD COLUMN dispatch_started_at INTEGER;
