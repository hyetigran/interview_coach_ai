import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { createReviewSchema, type Review } from '../lib/reviews/contracts';
import { reviews } from './schema';

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
    async list(ownerId: string): Promise<Review[]> {
      return db.select(fields).from(reviews).where(activeOwner(ownerId)).orderBy(desc(reviews.createdAt), desc(reviews.id)).limit(100);
    },
    async get(ownerId: string, id: string): Promise<Review | null> {
      return await db.select(fields).from(reviews).where(and(activeOwner(ownerId), eq(reviews.id, id))).get() ?? null;
    },
    async remove(ownerId: string, id: string): Promise<void> {
      await db.delete(reviews).where(and(eq(reviews.ownerId, ownerId), eq(reviews.id, id)));
    },
  };
}
