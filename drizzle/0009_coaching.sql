CREATE TABLE coaching_runs (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'running', deadline INTEGER NOT NULL,
 model TEXT NOT NULL, prompt_version TEXT NOT NULL, rubric_version TEXT NOT NULL, schema_version TEXT NOT NULL, verification_version TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE coaching_jobs (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, thread_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', sources TEXT, draft TEXT, result TEXT, error TEXT,
 started_at INTEGER, UNIQUE(run_id,thread_id)
);
