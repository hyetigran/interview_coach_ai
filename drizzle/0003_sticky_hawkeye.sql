CREATE TABLE `processing_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`reserved_units` integer NOT NULL,
	`settled_units` integer,
	`state` text DEFAULT 'reserved' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`dispatch_state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`deadline` integer DEFAULT 0 NOT NULL,
	`finished_at` integer,
	`error` text,
	`result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processing_jobs_upload_id_unique` ON `processing_jobs` (`upload_id`);--> statement-breakpoint
ALTER TABLE `reviews` ADD `input_revision` integer DEFAULT 1 NOT NULL;