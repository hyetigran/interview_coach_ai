CREATE TABLE transcription_part_manifests (
  transcription_id TEXT PRIMARY KEY NOT NULL,
  identity TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE transcription_parts (
  transcription_id TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK(part_index BETWEEN 0 AND 2),
  offset_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 1 AND 1200000),
  source_sha256 TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  paid_attempt INTEGER NOT NULL DEFAULT 0,
  provider_identity TEXT,
  receipt_key TEXT,
  request_id TEXT,
  submitted_at INTEGER,
  charge_units INTEGER,
  PRIMARY KEY(transcription_id,part_index)
);
