CREATE TABLE `speaker_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`transcript_id` text NOT NULL,
	`speakers` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`dispatch_state` text DEFAULT 'pending' NOT NULL,
	`confirmed_at` integer NOT NULL,
	`deadline` integer DEFAULT 0 NOT NULL,
	`cancellation_attempted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_confirmations_review_id_unique` ON `speaker_confirmations` (`review_id`);