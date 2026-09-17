ALTER TABLE coaching_jobs ADD COLUMN draft_dispatched INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE coaching_jobs ADD COLUMN verify_dispatched INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Older interrupted jobs have no durable dispatch markers. Treat them as
-- potentially sent; never release an unknown historical charge by migration.
UPDATE coaching_jobs SET draft_dispatched=1, verify_dispatched=1 WHERE state<>'queued';
