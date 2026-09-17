import { z } from 'zod';
export const createReviewSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(120),
  role: z.string().trim().min(1, 'Enter your target role.').max(120),
  origin: z.enum(['hiring', 'mock']),
}).strict();
export type CreateReview = z.infer<typeof createReviewSchema>;
export type Review = CreateReview & { id: string; createdAt: number; updatedAt: number };
export type ReviewPage = { items: Review[]; nextCursor: string | null };
