ALTER TABLE speaker_confirmations ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE speaker_confirmations ADD COLUMN dispatch_started_at INTEGER NOT NULL DEFAULT 0;
