DROP INDEX `speaker_confirmations_review_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_review_revision` ON `speaker_confirmations` (`review_id`,`revision`);