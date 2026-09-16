import { and, desc, eq, lt, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { createReviewSchema, type Review, type ReviewPage } from '../lib/reviews/contracts';
import { reviews } from './schema';

const cursorSchema = z.string().max(512).transform((value, ctx) => {
  try { return JSON.parse(atob(value)); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid review cursor.' }); return z.NEVER; }
}).pipe(z.object({ createdAt: z.number().int().nonnegative(), id: z.uuid() }));

export function createReviewModule(binding: D1Database) {
  const db = drizzle(binding);
  const activeOwner = (ownerId: string) => and(eq(reviews.ownerId, ownerId), eq(reviews.lifecycle, 'active'));
  const fields = { id: reviews.id, title: reviews.title, role: reviews.role, origin: reviews.origin, createdAt: reviews.createdAt, updatedAt: reviews.updatedAt };
  return {
    async create(ownerId: string, input: unknown): Promise<Review> {
      const valid = createReviewSchema.parse(input);
      const now = Date.now();
      const result = { ...valid, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      await db.insert(reviews).values({ ...result, ownerId });
      return result;
    },
    async list(ownerId: string, cursor?: string): Promise<ReviewPage> {
      const after = cursor ? cursorSchema.parse(cursor) : null;
      const rows = await db.select(fields).from(reviews).where(and(activeOwner(ownerId), after ? or(
        lt(reviews.createdAt, after.createdAt), and(eq(reviews.createdAt, after.createdAt), lt(reviews.id, after.id)),
      ) : undefined)).orderBy(desc(reviews.createdAt), desc(reviews.id)).limit(51);
      const items = rows.slice(0, 50);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > 50 && last ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id })) : null };
    },
    async get(ownerId: string, id: string): Promise<Review | null> {
      return await db.select(fields).from(reviews).where(and(activeOwner(ownerId), eq(reviews.id, id))).get() ?? null;
    },
    async remove(ownerId: string, id: string): Promise<void> {
      await db.delete(reviews).where(and(eq(reviews.ownerId, ownerId), eq(reviews.id, id)));
    },
  };
}
