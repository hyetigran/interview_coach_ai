import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const processingJobs = sqliteTable('processing_jobs', {
  id: text().primaryKey(), reviewId: text('review_id').notNull(), ownerId: text('owner_id').notNull(), uploadId: text('upload_id').notNull().unique(),
  revision: integer().notNull().default(1), state: text().notNull().default('queued'), dispatchState: text('dispatch_state').notNull().default('pending'),
  createdAt: integer('created_at').notNull(), deadline: integer().notNull().default(0), finishedAt: integer('finished_at'), error: text(), result: text(), cancellationAttemptedAt: integer('cancellation_attempted_at'),
});
export const processingBudget = sqliteTable('processing_budget', {
  id: text().primaryKey(), operation: text().notNull(), reservedUnits: integer('reserved_units').notNull(), settledUnits: integer('settled_units'), state: text().notNull().default('reserved'),
});

export const transcriptions = sqliteTable('transcriptions', {
  id: text().primaryKey(), reviewId: text('review_id').notNull(), ownerId: text('owner_id').notNull(), jobId: text('job_id').notNull().unique(),
  revision: integer().notNull(), state: text().notNull().default('queued'), resultKey: text('result_key'), requestId: text('request_id'),
  error: text(), startedAt: integer('started_at'), finishedAt: integer('finished_at'),
});

export const speakerConfirmations = sqliteTable('speaker_confirmations', {
  id: text().primaryKey(), reviewId: text('review_id').notNull().unique(), ownerId: text('owner_id').notNull(), transcriptId: text('transcript_id').notNull(),
  speakers: text().notNull(), revision: integer().notNull(), state: text().notNull().default('queued'), dispatchState: text('dispatch_state').notNull().default('pending'),
  confirmedAt: integer('confirmed_at').notNull(), deadline: integer().notNull().default(0), cancellationAttemptedAt: integer('cancellation_attempted_at'),
});
