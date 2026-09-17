import { createGroupingModule } from './grouping';
import { createRuntimeSpeakers, SpeakerError } from './speakers';
import { createTranscriptionModule } from './transcription';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { ZodError } from 'zod';
import { createAuth } from './auth';
import { invitations } from './schema';
import { createReviewModule } from './reviews';
import { createRuntimeProcessing } from './processing';
import { createMediaModule, MediaError } from './media';
import { PART_BYTES } from '../lib/media/contracts';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function createApplication(env: CloudflareEnv) {
  const auth = createAuth(env);
  const reviews = createReviewModule(env.DB);
  const db = drizzle(env.DB);
  const media = createMediaModule(env);
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const path = new URL(request.url).pathname;
        if (!['GET', 'HEAD'].includes(request.method)) {
          if (request.headers.get('origin') !== env.APP_ORIGIN) return json({ error: 'This request must come from the application.' }, 403);
          if (request.headers.get('content-type')?.split(';')[0] !== (/^\/api\/reviews\/[a-f0-9-]{36}\/uploads\/[a-f0-9-]{36}\/parts\/\d+$/.test(path) && request.method === 'PUT' ? 'application/octet-stream' : 'application/json')) return json({ error: 'JSON is required.' }, 415);
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
          if (request.method === 'GET') return json(await reviews.list(session.user.id, new URL(request.url).searchParams.get('cursor') ?? undefined));
          if (request.method === 'POST') {
            const body = await request.text();
            if (new TextEncoder().encode(body).length > 4096) return json({ error: 'Review details are too large.' }, 413);
            return json(await reviews.create(session.user.id, JSON.parse(body)), 201);
          }
          return json({ error: 'Method not allowed.' }, 405);
        }
        const mediaPath = /^\/api\/reviews\/([a-f0-9-]{36})\/(media|audio|deletion|processing|transcript|speakers|threads|uploads\/([a-f0-9-]{36})\/(complete|parts\/(\d+)(\/sign)?))$/.exec(path);
        if (mediaPath) {
          const [, reviewId, action, uploadId, operation, part, sign] = mediaPath;
          if (action === 'threads' && request.method === 'GET') {
            if (!await reviews.get(session.user.id, reviewId)) return json({ error: 'Review not found.' }, 404);
            return json(await createGroupingModule(env).status(session.user.id, reviewId));
          }
          if (action === 'speakers') {
            if (!await reviews.get(session.user.id, reviewId)) return json({ error: 'Review not found.' }, 404);
            if (request.method === 'GET') return json(await createRuntimeSpeakers(env).status(session.user.id,reviewId));
            if (request.method === 'POST') return json(await createRuntimeSpeakers(env).confirm(session.user.id,reviewId,JSON.parse(new TextDecoder().decode(await boundedBytes(request,16000)))));
          }
          if (action === 'transcript' && request.method === 'GET') {
            if (!await reviews.get(session.user.id, reviewId)) return json({ error: 'Review not found.' }, 404);
            return json(await createTranscriptionModule(env).status(session.user.id, reviewId));
          }
          if (action === 'processing' && request.method === 'GET') {
            if (!await reviews.get(session.user.id, reviewId)) return json({ error: 'Review not found.' }, 404);
            return json(await createRuntimeProcessing(env).status(session.user.id, reviewId));
          }
          if (action === 'deletion' && request.method === 'GET') return json(await media.deletionStatus(session.user.id, reviewId));
          if (action === 'audio' && ['GET', 'HEAD'].includes(request.method)) return await media.play(session.user.id, reviewId, request.headers.get('range'), request.method === 'HEAD');
          if (action === 'media' && request.method === 'GET') return json(await media.status(session.user.id, reviewId));
          if (action === 'media' && request.method === 'POST') return json(await media.initiate(session.user.id, reviewId, JSON.parse(new TextDecoder().decode(await boundedBytes(request, 4096)))));
          if (operation === 'complete' && request.method === 'POST') return json(await media.complete(session.user.id, reviewId, uploadId));
          if (part && sign && request.method === 'POST') return json(await media.signPart(session.user.id, reviewId, uploadId, Number(part)));
          if (part && !sign && request.method === 'PUT') {
            await media.putPart(session.user.id, reviewId, uploadId, Number(part), request.headers.get('x-part-capability') ?? '', await boundedBytes(request, PART_BYTES));
            return json({ saved: true });
          }
          return json({ error: 'Method not allowed.' }, 405);
        }
        const match = /^\/api\/reviews\/([a-f0-9-]{36})$/.exec(path);
        if (match && request.method === 'GET') {
          const review = await reviews.get(session.user.id, match[1]);
          return review ? json(review) : json({ error: 'Review not found.' }, 404);
        }
        if (match && request.method === 'DELETE') {
          const deletion = await media.remove(session.user.id, match[1]);
          if (deletion.cleanupPending) return json(deletion, 202);
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
        }
        return json({ error: 'Not found.' }, 404);
      } catch (error) {
        if (error instanceof SpeakerError) return json({ error: error.message }, error.status);
        if (error instanceof MediaError) return json({ error: error.message }, error.status);
        if (error instanceof ZodError) return json({ error: 'Check the supplied fields and try again.', fields: error.flatten().fieldErrors }, 400);
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
        // Do not expose database failures, credentials, or private inputs in logs/responses.
        return json({ error: 'Unable to complete the request. Please try again.' }, 503);
      }
    },
  };
}

async function boundedBytes(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new MediaError(413, 'Request is too large.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
