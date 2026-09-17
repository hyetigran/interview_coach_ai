CREATE TABLE grouping_runs (
 id TEXT PRIMARY KEY NOT NULL, review_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 transcript_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'running',
 total INTEGER NOT NULL, deadline INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE grouping_chunks (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, started_at INTEGER,
 UNIQUE(run_id,ordinal)
);
