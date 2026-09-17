CREATE TABLE `upload_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`number` integer NOT NULL,
	`etag` text NOT NULL,
	`sha256` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `parts_upload` ON `upload_parts` (`upload_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`review_id` text NOT NULL,
	`action_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`state` text DEFAULT 'initializing' NOT NULL,
	`object_key` text NOT NULL,
	`multipart_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`admitted_at` integer,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`cleaned_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_object_key_unique` ON `uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `uploads_owner` ON `uploads` (`owner_id`,`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `uploads_review` ON `uploads` (`review_id`);