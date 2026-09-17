import { uniqueIndex, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('users', {
  id: text().primaryKey(), name: text().notNull(), email: text().notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false), image: text(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export const session = sqliteTable('sessions', {
  id: text().primaryKey(), token: text().notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
}, t => [index('sessions_user').on(t.userId)]);
export const account = sqliteTable('accounts', {
  id: text().primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }), refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text(), password: text(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('accounts_user').on(t.userId)]);
export const verification = sqliteTable('verifications', {
  id: text().primaryKey(), identifier: text().notNull(), value: text().notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export const rateLimit = sqliteTable('rate_limits', {
  id: text().primaryKey(), key: text().notNull().unique(), count: integer().notNull(), lastRequest: integer('last_request').notNull(),
});
export const invitations = sqliteTable('invitations', {
  email: text().primaryKey(), tokenHash: text('token_hash').notNull().unique(), expiresAt: integer('expires_at').notNull(),
  revoked: integer({ mode: 'boolean' }).notNull().default(false), consumedAt: integer('consumed_at'),
});
export const reviews = sqliteTable('reviews', {
  coachingRevision: integer('coaching_revision').notNull().default(1),
  id: text().primaryKey(), ownerId: text('owner_id').notNull(), title: text().notNull(), role: text().notNull(),
  origin: text({ enum: ['hiring', 'mock'] }).notNull(),
  inputRevision: integer('input_revision').notNull().default(1),
  lifecycle: text({ enum: ['active', 'deleting'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [index('reviews_owner').on(t.ownerId, t.lifecycle, t.createdAt)]);

export const uploads = sqliteTable('uploads', {
  id: text().primaryKey(), ownerId: text('owner_id').notNull(), reviewId: text('review_id').notNull(),
  actionId: text('action_id').notNull(), name: text().notNull(), size: integer().notNull(),
  state: text().notNull().default('initializing'), objectKey: text('object_key').notNull().unique(),
  multipartId: text('multipart_id'), expiresAt: integer('expires_at').notNull(), createdAt: integer('created_at').notNull(),
  admittedAt: integer('admitted_at'), lockUntil: integer('lock_until').notNull().default(0), cleanedAt: integer('cleaned_at'), claimToken: text('claim_token'), cleanupAttemptedAt: integer('cleanup_attempted_at'),
}, t => [index('uploads_owner').on(t.ownerId, t.state, t.expiresAt), index('uploads_review').on(t.reviewId)]);
export const uploadParts = sqliteTable('upload_parts', {
  id: text().primaryKey(), uploadId: text('upload_id').notNull(), number: integer().notNull(),
  etag: text().notNull(), sha256: text().notNull(),
}, t => [index('parts_upload').on(t.uploadId)]);

export const processingJobs = sqliteTable('processing_jobs', {attempt:integer().notNull().default(0),failureKind:text('failure_kind').notNull().default('retryable'),recoveryActionId:text('recovery_action_id'),dispatchAttempts:integer('dispatch_attempts').notNull().default(0),dispatchStartedAt:integer('dispatch_started_at').notNull().default(0),
  id: text().primaryKey(), reviewId: text('review_id').notNull(), ownerId: text('owner_id').notNull(), uploadId: text('upload_id').notNull().unique(),
  revision: integer().notNull().default(1), state: text().notNull().default('queued'), dispatchState: text('dispatch_state').notNull().default('pending'),
  createdAt: integer('created_at').notNull(), deadline: integer().notNull().default(0), finishedAt: integer('finished_at'), error: text(), result: text(), cancellationAttemptedAt: integer('cancellation_attempted_at'),
});
export const processingBudget = sqliteTable('processing_budget', {
  id: text().primaryKey(), operation: text().notNull(), reservedUnits: integer('reserved_units').notNull(), settledUnits: integer('settled_units'), state: text().notNull().default('reserved'),
});

export const transcriptions = sqliteTable('transcriptions', {paidAttempt:integer('paid_attempt').notNull().default(0),recoveryActionId:text('recovery_action_id'),publicationCheckedAt:integer('publication_checked_at').notNull().default(0),publicationAttempts:integer('publication_attempts').notNull().default(0),publicationDeadline:integer('publication_deadline').notNull().default(0),
  parentId:text('parent_id'),correctedUtteranceId:text('corrected_utterance_id'),
  id: text().primaryKey(), reviewId: text('review_id').notNull(), ownerId: text('owner_id').notNull(), jobId: text('job_id').notNull().unique(),
  revision: integer().notNull(), state: text().notNull().default('queued'), resultKey: text('result_key'), requestId: text('request_id'),
  error: text(), startedAt: integer('started_at'), finishedAt: integer('finished_at'),
});

export const speakerConfirmations = sqliteTable('speaker_confirmations', {dispatchAttempts:integer('dispatch_attempts').notNull().default(0),dispatchStartedAt:integer('dispatch_started_at').notNull().default(0),retryAttempts:integer('retry_attempts').notNull().default(1),
  contextRevision:integer('context_revision').notNull().default(1),
  id: text().primaryKey(), reviewId: text('review_id').notNull(), ownerId: text('owner_id').notNull(), transcriptId: text('transcript_id').notNull(),
  speakers: text().notNull(), revision: integer().notNull(), state: text().notNull().default('queued'), dispatchState: text('dispatch_state').notNull().default('pending'),
  confirmedAt: integer('confirmed_at').notNull(), deadline: integer().notNull().default(0), cancellationAttemptedAt: integer('cancellation_attempted_at'),
}, table => [uniqueIndex('speaker_review_revision').on(table.reviewId, table.revision)]);

export const groupingRuns = sqliteTable('grouping_runs', {recoveryActionId:text('recovery_action_id'),
  outputVersion:integer('output_version').notNull().default(0),
  id:text().primaryKey(),reviewId:text('review_id').notNull(),ownerId:text('owner_id').notNull(),transcriptId:text('transcript_id').notNull(),
  revision:integer().notNull(),state:text().notNull().default('running'),total:integer().notNull(),deadline:integer().notNull(),
});
export const groupingChunks = sqliteTable('grouping_chunks', {attempt:integer().notNull().default(0),inputPayload:text('input_payload'),reuseResult:text('reuse_result'),reuseInput:text('reuse_input'),recoveryActionId:text('recovery_action_id'),submitted:integer().notNull().default(0),publicationAttempts:integer('publication_attempts').notNull().default(0),publicationDeadline:integer('publication_deadline').notNull().default(0),publicationCheckedAt:integer('publication_checked_at').notNull().default(0),
  id:text().primaryKey(),runId:text('run_id').notNull(),ordinal:integer().notNull(),state:text().notNull().default('queued'),result:text(),error:text(),startedAt:integer('started_at'),
},table=>[uniqueIndex('grouping_chunk_ordinal').on(table.runId,table.ordinal)]);

export const coachingRuns = sqliteTable('coaching_runs',{retryAttempts:integer('retry_attempts').notNull().default(1),dispatchAttempts:integer('dispatch_attempts').notNull().default(0),dispatchStartedAt:integer('dispatch_started_at').notNull().default(0),groupingVersion:integer('grouping_version').notNull().default(0),
 contextRevision:integer('context_revision').notNull().default(1),groupingId:text('grouping_id').notNull().default(''),dispatchState:text('dispatch_state').notNull().default('sent'),
 id:text().primaryKey(),reviewId:text('review_id').notNull(),ownerId:text('owner_id').notNull(),revision:integer().notNull(),state:text().notNull().default('running'),deadline:integer().notNull(),
 model:text().notNull(),promptVersion:text('prompt_version').notNull(),rubricVersion:text('rubric_version').notNull(),schemaVersion:text('schema_version').notNull(),verificationVersion:text('verification_version').notNull(),
},table=>[uniqueIndex('coaching_input_context_grouping').on(table.reviewId,table.revision,table.contextRevision,table.groupingVersion)]);
export const coachingJobs = sqliteTable('coaching_jobs',{attempt:integer().notNull().default(0),draftAttempt:integer('draft_attempt').notNull().default(0),reuseDraft:text('reuse_draft'),recoveryActionId:text('recovery_action_id'),
 publicationAttempts:integer('publication_attempts').notNull().default(0),publicationDeadline:integer('publication_deadline').notNull().default(0),publicationCheckedAt:integer('publication_checked_at').notNull().default(0),
 id:text().primaryKey(),runId:text('run_id').notNull(),threadId:text('thread_id').notNull(),state:text().notNull().default('queued'),sources:text(),draft:text(),result:text(),error:text(),startedAt:integer('started_at'),draftDispatched:integer('draft_dispatched').notNull().default(0),verifyDispatched:integer('verify_dispatched').notNull().default(0),
},table=>[uniqueIndex('coaching_thread').on(table.runId,table.threadId)]);

export const reviewContextVersions=sqliteTable('review_context_versions',{id:text().primaryKey(),reviewId:text('review_id').notNull(),revision:integer().notNull(),body:text().notNull(),createdAt:integer('created_at').notNull()},table=>[uniqueIndex('context_review_revision').on(table.reviewId,table.revision)]);
export const reviewPriorities=sqliteTable('review_priorities',{reviewId:text('review_id').primaryKey(),version:integer().notNull(),body:text().notNull(),updatedAt:integer('updated_at').notNull()});
export const savedAnswers=sqliteTable('saved_answers',{id:text().primaryKey(),reviewId:text('review_id').notNull(),coachingJobId:text('coaching_job_id').notNull(),threadId:text('thread_id').notNull(),version:integer().notNull(),body:text().notNull(),sources:text().notNull(),coachingResult:text('coaching_result').notNull(),createdAt:integer('created_at').notNull()},table=>[uniqueIndex('saved_answer_version').on(table.reviewId,table.coachingJobId,table.version)]);

export const transcriptCorrectionIntents=sqliteTable('transcript_correction_intents',{candidateSpeakers:text('candidate_speakers'),manualGroups:text('manual_groups'),manualReview:integer('manual_review').notNull().default(0),coverage:text(),id:text().primaryKey(),reviewId:text('review_id').notNull(),ownerId:text('owner_id').notNull(),parentId:text('parent_id').notNull(),revision:integer().notNull(),resultKey:text('result_key').notNull(),state:text().notNull().default('preparing'),createdAt:integer('created_at').notNull(),reuseGroupingId:text('reuse_grouping_id'),reusePrefix:integer('reuse_prefix').notNull().default(0)});

export const recoveryRequests=sqliteTable('recovery_requests',{plan:text(),targetAttempt:integer('target_attempt').notNull().default(0),dispatchState:text('dispatch_state').notNull().default('pending'),dispatchAttempts:integer('dispatch_attempts').notNull().default(0),dispatchStartedAt:integer('dispatch_started_at'),id:text().primaryKey(),reviewId:text('review_id').notNull(),ownerId:text('owner_id').notNull(),stage:text().notNull(),targetId:text('target_id').notNull(),inputRevision:integer('input_revision').notNull(),contextRevision:integer('context_revision').notNull(),state:text().notNull().default('pending'),createdAt:integer('created_at').notNull()});
