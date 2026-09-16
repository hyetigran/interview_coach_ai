import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { ZodError } from 'zod';
import { createAuth } from './auth';
import { invitations } from './schema';
import { createReviewModule } from './reviews';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function createApplication(env: CloudflareEnv) {
  const auth = createAuth(env);
  const reviews = createReviewModule(env.DB);
  const db = drizzle(env.DB);
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const path = new URL(request.url).pathname;
        if (!['GET', 'HEAD'].includes(request.method)) {
          if (request.headers.get('origin') !== env.APP_ORIGIN) return json({ error: 'This request must come from the application.' }, 403);
          if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'JSON is required.' }, 415);
        }
        if (path.startsWith('/api/auth/')) {
          const response = await auth.handler(request);
          response.headers.set('Cache-Control', 'private, no-store');
          return response;
        }
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: 'Sign in to continue.' }, 401);
        const invited = await db.select({ email: invitations.email }).from(invitations).where(and(eq(invitations.email, session.user.email), eq(invitations.revoked, false))).get();
        if (!invited) return json({ error: 'An active pilot invitation is required.' }, 403);
        if (path === '/api/me' && request.method === 'GET') return json({ id: session.user.id, name: session.user.name, email: session.user.email });
        if (path === '/api/reviews') {
          if (request.method === 'GET') return json(await reviews.list(session.user.id));
          if (request.method === 'POST') {
            const body = await request.text();
            if (new TextEncoder().encode(body).length > 4096) return json({ error: 'Review details are too large.' }, 413);
            return json(await reviews.create(session.user.id, JSON.parse(body)), 201);
          }
          return json({ error: 'Method not allowed.' }, 405);
        }
        const match = /^\/api\/reviews\/([a-f0-9-]{36})$/.exec(path);
        if (match && request.method === 'GET') {
          const review = await reviews.get(session.user.id, match[1]);
          return review ? json(review) : json({ error: 'Review not found.' }, 404);
        }
        if (match && request.method === 'DELETE') {
          await reviews.remove(session.user.id, match[1]);
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
        }
        return json({ error: 'Not found.' }, 404);
      } catch (error) {
        if (error instanceof ZodError) return json({ error: 'Enter a title, target role, and interview type.', fields: error.flatten().fieldErrors }, 400);
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
        // Do not expose database failures, credentials, or private inputs in logs/responses.
        return json({ error: 'Unable to complete the request. Please try again.' }, 503);
      }
    },
  };
}
