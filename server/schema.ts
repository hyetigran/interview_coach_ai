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
