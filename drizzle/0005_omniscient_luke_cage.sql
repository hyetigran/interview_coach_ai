CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`result_key` text,
	`request_id` text,
	`error` text,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcriptions_job_id_unique` ON `transcriptions` (`job_id`);