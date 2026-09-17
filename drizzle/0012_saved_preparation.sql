CREATE TABLE review_priorities (
 review_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE saved_answers (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, coaching_job_id TEXT NOT NULL, thread_id TEXT NOT NULL,
 version INTEGER NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, coaching_result TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(review_id,coaching_job_id,version)
);
--> statement-breakpoint
CREATE INDEX saved_answers_review ON saved_answers(review_id,coaching_job_id,version);
