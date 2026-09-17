import { z } from 'zod';
import { createBudgetLedger } from './budget';
import type { PreparationResult } from './processing';
import { parseTranscript, type Transcript } from '../lib/transcript';
type Environment = Pick<CloudflareEnv, 'DB' | 'MEDIA' | 'AUTH_SECRET' | 'OPENAI_API_KEY' | 'LOCAL_MEDIA_ADAPTER'>;
type Row = { id: string; review_id: string; owner_id: string; job_id: string; revision: number; state: string; result_key: string | null; error: string | null };
const active = "EXISTS(SELECT 1 FROM reviews WHERE reviews.id=transcriptions.review_id AND reviews.owner_id=transcriptions.owner_id AND reviews.lifecycle='active' AND reviews.input_revision=transcriptions.revision)";
export function transcriptionIntent(db: D1Database, jobId: string) {
  return db.prepare("INSERT OR IGNORE INTO transcriptions(id,review_id,owner_id,job_id,revision) SELECT 'transcript-'||id,review_id,owner_id,id,revision FROM processing_jobs WHERE id=? AND state='ready'").bind(jobId);
}
export function createTranscriptionModule(env: Environment, request: typeof fetch = fetch) {
  const db = env.DB; const budget = createBudgetLedger(db);
  async function live(id: string) { return db.prepare(`SELECT * FROM transcriptions WHERE id=? AND ${active}`).bind(id).first<Row>(); }
  async function status(owner: string, review: string) {
    const row = await db.prepare(`SELECT * FROM transcriptions WHERE owner_id=? AND review_id=? AND ${active}`).bind(owner, review).first<Row>();
    if (!row) return null;
    const object = row.state === 'ready' && row.result_key ? await env.MEDIA.get(row.result_key) : null;
    return { state: row.state, error: row.error, transcript: object ? await object.json<Transcript>() : null };
  }
  async function run(jobId: string) {
    const id = 'transcript-' + jobId; const row = await live(id);
    if (!row || row.state !== 'queued') return;
    if (!env.OPENAI_API_KEY) { await db.prepare("UPDATE transcriptions SET state='configuration',error='Transcription is not configured. Add OPENAI_API_KEY to .env and restart the local app.' WHERE id=? AND state='queued'").bind(id).run(); return; }
    const claim = await db.prepare(`UPDATE transcriptions SET state='encoding',started_at=? WHERE id=? AND state='queued' AND ${active}`).bind(Date.now(), id).run();
    if (!claim.meta.changes) return;
    let submitted = false; let receiptSaved = false;
    try {
      const preparation = await db.prepare("SELECT result FROM processing_jobs WHERE id=? AND state='ready'").bind(jobId).first<{ result: string }>();
      if (!preparation) throw new Error('Prepared audio is unavailable.');
      const audio = JSON.parse(preparation.result) as PreparationResult;
      const object = await env.MEDIA.get(audio.audioKey ?? audio.sourceKey);
      if (!object || env.LOCAL_MEDIA_ADAPTER !== 'http://127.0.0.1:8790') throw new Error('The local media service is required for transcription.');
      const encoded = await request(`${env.LOCAL_MEDIA_ADAPTER}/compression/${jobId}`, { method: 'POST', headers: { authorization: `Bearer ${env.AUTH_SECRET}` }, body: object.body, signal: AbortSignal.timeout(80000) });
      if (!encoded.ok || Number(encoded.headers.get('content-length')) > 15000000) throw new Error('Unable to prepare audio for transcription.');
      const bytes = await encoded.arrayBuffer(); if (bytes.byteLength > 15000000 || !bytes.byteLength) throw new Error('Compressed audio is invalid.');
      // Conservative local policy reservation, not a provider-enforced price ceiling.
      // Unknown billing retains this amount and is never retried automatically.
      const maximum = 6000000;
      if (!await budget.reserve(id, 'openai-diarization-v1', maximum)) { await db.prepare("UPDATE transcriptions SET state='budget_blocked',error='The processing allowance cannot cover this transcription.' WHERE id=? AND state='encoding'").bind(id).run(); return; }
      const permission = await db.prepare(`UPDATE transcriptions SET state='submitting' WHERE id=? AND state='encoding' AND ${active}`).bind(id).run();
      if (!permission.meta.changes) { await budget.settle(id, 0); return; }
      const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/mpeg' }), 'interview.mp3'); form.set('model', 'gpt-4o-transcribe-diarize'); form.set('response_format', 'diarized_json'); form.set('chunking_strategy', 'auto'); form.set('language', 'en');
      submitted = true;
      const response = await request('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'X-Client-Request-Id': id }, body: form, signal: AbortSignal.timeout(15 * 60000) });
      if (!response.ok) {
        if ([400, 401, 403, 413, 429].includes(response.status)) { await budget.settle(id, 0); submitted = false; }
        throw new Error(response.status === 429 ? 'OpenAI quota or rate limit reached. Check the API project billing.' : 'OpenAI could not complete transcription.');
      }
      const raw = await response.text(); if (new TextEncoder().encode(raw).length > 8000000) throw new Error('Transcript response exceeds supported limits.');
      const receiptKey = `transcripts/${row.review_id}/${id}.provider.json`;
      if (await live(id)) {
        await env.MEDIA.put(receiptKey, JSON.stringify({ requestId: response.headers.get('x-request-id'), response: raw }), { httpMetadata: { contentType: 'application/json' } });
        receiptSaved = true;
        await db.prepare('UPDATE transcriptions SET request_id=? WHERE id=?').bind(response.headers.get('x-request-id'), id).run();
        if (!await live(id)) await env.MEDIA.delete(receiptKey);
      }
      const data = JSON.parse(raw);
      const usage = z.object({ type: z.literal('tokens'), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).safeParse(data.usage);
      if (usage.success) await budget.settle(id, Math.ceil(usage.data.input_tokens * 2.5 + usage.data.output_tokens * 10));
      const { transcript } = parseTranscript(data, id, audio.sha256, audio.durationMs);
      const current = await live(id); if (!current || current.state !== 'submitting') return;
      const resultKey = `transcripts/${row.review_id}/${id}.json`;
      await env.MEDIA.put(resultKey, JSON.stringify(transcript), { httpMetadata: { contentType: 'application/json' } });
      const published = await db.prepare(`UPDATE transcriptions SET state='ready',result_key=?,finished_at=?,error=NULL WHERE id=? AND state='submitting' AND ${active}`).bind(resultKey, Date.now(), id).run();
      if (!published.meta.changes) await env.MEDIA.delete(resultKey);
    } catch {
      await db.prepare(`UPDATE transcriptions SET state=?,error=?,finished_at=? WHERE id=? AND state IN ('encoding','submitting') AND ${active}`).bind(receiptSaved ? 'reconciliation' : submitted ? 'unknown' : 'failed', receiptSaved ? 'OpenAI returned a result, which is safely stored. Its format or billing needs reconciliation before publication.' : submitted ? 'The paid transcription outcome needs reconciliation. It will not be submitted again automatically.' : 'Transcription could not start. Check local services, API access, and billing.', Date.now(), id).run();
    }
  }
  async function cleanup() {
    await db.prepare(`UPDATE transcriptions SET state='cancelled',error=NULL,result_key=NULL WHERE state<>'cancelled' AND NOT ${active}`).run();
    const cancelled = (await db.prepare("SELECT review_id,id FROM transcriptions WHERE state='cancelled'").all<{ review_id: string; id: string }>()).results;
    for (const row of cancelled) await env.MEDIA.delete([`transcripts/${row.review_id}/${row.id}.json`, `transcripts/${row.review_id}/${row.id}.provider.json`]);
    // A process crash after submitting cannot trigger another paid request.
    await db.prepare("UPDATE transcriptions SET state='unknown',error='The transcription was interrupted. Billing and outcome need reconciliation.' WHERE state IN ('encoding','submitting') AND started_at<?").bind(Date.now() - 20 * 60000).run();
  }
  return { run, status, cleanup };
}
