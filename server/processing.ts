import {transcriptionAttemptId} from '../lib/transcription-attempt';
import {mediaServiceRequest, type MediaServiceEnvironment} from './media-service';
import {reconcileProviderBilling} from './historical-billing';
import {accountSlotAvailable} from './account-slot';
import {preparationAttemptId} from '../lib/preparation-attempt';
import { transcriptionIntent } from './transcription';
import { createHash } from 'node:crypto';
import { validateWave } from './audio-format';
import { MAX_AUDIO_BYTES } from '../lib/media/contracts';
type Environment = MediaServiceEnvironment & { DB: D1Database; MEDIA: R2Bucket };
type Job = { attempt:number; failure_kind:string; dispatch_attempts:number; dispatch_started_at:number; id: string; review_id: string; owner_id: string; upload_id: string; state: string; dispatch_state: string; revision: number; deadline: number; result: string | null; error: string | null };
class InvalidRecording extends Error {}
const active = "EXISTS(SELECT 1 FROM reviews WHERE reviews.id=processing_jobs.review_id AND reviews.owner_id=processing_jobs.owner_id AND reviews.lifecycle='active' AND reviews.input_revision=processing_jobs.revision)";
export type PreparationResult = { sourceKey: string; sourceSha256?: string; sourceBytes?: number; sha256: string; bytes: number; durationMs: number; channels: number; sampleRate: number; audioKey?: string; audioBytes?: number; originalTimeOffsetMs?: number };
export function initialJobStatement(db: D1Database, uploadId: string) {
  return db.prepare("INSERT OR IGNORE INTO processing_jobs(id,review_id,owner_id,upload_id,revision,created_at) SELECT 'prepare-'||uploads.id,uploads.review_id,uploads.owner_id,uploads.id,reviews.input_revision,? FROM uploads JOIN reviews ON reviews.id=uploads.review_id WHERE uploads.id=? AND uploads.state IN ('admitted','validating') AND reviews.lifecycle='active'").bind(Date.now(), uploadId);
}
export function createProcessingModule(env: Environment, dispatch?: (id: string,attempt:number) => Promise<void>, terminate?: (id: string,attempt:number) => Promise<void>) {
  const { DB: db, MEDIA: bucket } = env;
  async function reconcile() {
    await reconcileProviderBilling(env);
    if (terminate) {
      const cancelled = (await db.prepare("SELECT id,attempt FROM processing_jobs WHERE state IN ('cancelled','failed') AND dispatch_state='cancel_pending' ORDER BY COALESCE(cancellation_attempted_at,0),id LIMIT 25").all<{ id: string;attempt:number }>()).results;
      for (const job of cancelled) { await db.prepare('UPDATE processing_jobs SET cancellation_attempted_at=? WHERE id=?').bind(Date.now(), job.id).run(); try { await terminate(job.id,job.attempt); await db.prepare("UPDATE processing_jobs SET dispatch_state='cancelled' WHERE id=? AND attempt=? AND state IN ('cancelled','failed')").bind(job.id,job.attempt).run(); } catch { /* Retry cancellation without exposing content. */ } }
    }
    await db.prepare(`UPDATE processing_jobs SET dispatch_state=CASE WHEN state='queued' OR (state='cancelled' AND dispatch_state='cancelled') THEN 'cancelled' ELSE 'cancel_pending' END,state='cancelled',result=NULL,error=NULL,finished_at=? WHERE state IN ('queued','running') AND NOT ${active}`).bind(Date.now()).run();
    await db.prepare("UPDATE processing_jobs SET state='failed',dispatch_state='cancel_pending',error='Preparation timed out. The recording is retained until its upload expires; retry after cancellation completes.',finished_at=? WHERE state='running' AND deadline<=?").bind(Date.now(), Date.now()).run();
    await rejectFailedVideos();
    if (!dispatch) return;
    const jobs = (await db.prepare("SELECT * FROM processing_jobs WHERE state='queued' OR (state='running' AND dispatch_state IN ('pending','sending') AND dispatch_attempts<3 AND dispatch_started_at<?) ORDER BY created_at,id LIMIT 25").bind(Date.now()-10000).all<Job>()).results;
    for (const job of jobs) {
      if (job.state === 'queued') {
        const claimed = await db.prepare(`UPDATE processing_jobs SET state='running',deadline=? WHERE id=? AND attempt=? AND state='queued' AND ${active} AND ${accountSlotAvailable('processing_jobs.owner_id')}`).bind(Date.now() + 5 * 60000, job.id,job.attempt).run();
        if (!claimed.meta.changes) continue;
      }
      const dispatchClaim=await db.prepare("UPDATE processing_jobs SET dispatch_state='sending',dispatch_attempts=dispatch_attempts+1,dispatch_started_at=? WHERE id=? AND attempt=? AND state='running' AND dispatch_state IN ('pending','sending') AND dispatch_attempts<3 AND dispatch_started_at<?").bind(Date.now(),job.id,job.attempt,Date.now()-10000).run();
      if(!dispatchClaim.meta.changes)continue;
      try {
        // createBatch uses this stable ID idempotently, including after a lost response.
        await dispatch(job.id,job.attempt);
        await db.prepare("UPDATE processing_jobs SET dispatch_state='sent' WHERE id=? AND attempt=? AND state='running'").bind(job.id,job.attempt).run();
      } catch { /* Intent remains pending; a scheduled reconciler retries the same ID. */ }
    }
  }
  async function status(owner: string, review: string) {
    const job = await db.prepare('SELECT * FROM processing_jobs WHERE review_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 1').bind(review, owner).first<Job>();
    if (!job) return null;
    const upload=await db.prepare("SELECT id FROM uploads WHERE id=? AND (state='admitted' OR (state='validating' AND expires_at>?))").bind(job.upload_id,Date.now()).first();
    const retry={attempt:job.attempt,canRetry:job.state==='failed'&&job.failure_kind==='retryable'&&job.attempt<2&&job.dispatch_state==='cancelled'&&!!upload,waiting:job.state==='failed'&&job.dispatch_state==='cancel_pending',reason:job.failure_kind==='invalid'?'This recording is invalid. Export it again and start a new review.':!upload?'The recording is unavailable or expired. Start a new review.':job.attempt>=2?'Preparation reached its three-attempt limit.':job.dispatch_state==='cancel_pending'?'Stopping the previous preparation attempt before retrying.':'Retry preparation using the saved recording.'};
    return { id: job.id,retry, state: job.state, error: job.error, result: job.result ? JSON.parse(job.result) as PreparationResult : null };
  }
  async function live(id: string,attempt:number) {
    const job = await db.prepare(`SELECT * FROM processing_jobs WHERE id=? AND attempt=? AND state='running' AND deadline>? AND ${active}`).bind(id,attempt, Date.now()).first<Job>();
    if (!job) throw new Error('Preparation is no longer active.'); return job;
  }
  async function prepare(id:string,attempt=0):Promise<PreparationResult> {
    try{return await prepareAttempt(id,attempt);}catch(error){
      if(error instanceof InvalidRecording)await db.prepare("UPDATE processing_jobs SET failure_kind='invalid' WHERE id=? AND attempt=? AND state='running'").bind(id,attempt).run();
      throw error;
    }
  }
  async function prepareAttempt(id: string,attempt:number): Promise<PreparationResult> {
    const existing = await db.prepare(`SELECT result FROM processing_jobs WHERE id=? AND state='ready' AND ${active}`).bind(id).first<{ result: string }>();
    if (existing) return JSON.parse(existing.result);
    const job = await live(id,attempt);
    const upload = await db.prepare("SELECT object_key,size,name FROM uploads WHERE id=? AND review_id=? AND state IN ('admitted','validating')").bind(job.upload_id, job.review_id).first<{ object_key: string; size: number; name: string }>();
    if (!upload) throw new Error('Recording is not available.');
    let audioKey = upload.object_key;
    const original = await bucket.get(upload.object_key);
    if (!original || original.size !== upload.size || original.size > MAX_AUDIO_BYTES) throw new InvalidRecording('Recording is incomplete or too large.');
    const sourceHash = createHash('sha256'); const sourceReader = original.body.getReader(); let sourceBytes = 0;
    try { while (true) { const { done, value } = await sourceReader.read(); if (done) break; sourceBytes += value.byteLength; if (sourceBytes > MAX_AUDIO_BYTES || Date.now() >= job.deadline) { await sourceReader.cancel(); throw new Error('Recording exceeds preparation limits.'); } sourceHash.update(value); } } finally { sourceReader.releaseLock(); }
    if (sourceBytes !== upload.size) throw new InvalidRecording('Recording is incomplete.');
    const sourceSha256 = sourceHash.digest('hex');
    if (!/\.wav$/i.test(upload.name)) {
      const source = await bucket.get(upload.object_key);
      if (!source || source.size !== upload.size || source.size > MAX_AUDIO_BYTES) throw new InvalidRecording('Recording is incomplete or too large.');
      const response = await mediaServiceRequest(env, `/operations/${preparationAttemptId(id,attempt)}`, { method: 'POST', body: source.body, signal: AbortSignal.timeout(80000) });
      if (!response.ok || !response.body) {const message=(await response.text()).slice(0,200)||'Video preparation failed.';throw response.status===422?new InvalidRecording(message):new Error(message);}
      await live(id,attempt);
      audioKey = 'audio/' + job.upload_id + '/' + crypto.randomUUID();
      await bucket.put(audioKey, response.body, { httpMetadata: { contentType: 'audio/wav' } });
      try { await live(id,attempt); } catch (error) { await bucket.delete(audioKey); throw error; }
    }
    const object = await bucket.get(audioKey);
    if (!object || (audioKey === upload.object_key && object.size !== upload.size) || object.size > MAX_AUDIO_BYTES || object.httpMetadata?.contentType !== 'audio/wav') throw new InvalidRecording('Recording size or media type is invalid.');
    const hash = createHash('sha256'); const reader = object.body.getReader(); const header = new Uint8Array(44); let observed = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (observed < 44) header.set(value.slice(0, 44 - observed), observed);
        observed += value.byteLength;
        if (observed > MAX_AUDIO_BYTES || Date.now() >= job.deadline) { await reader.cancel(); throw new Error('Recording exceeds preparation limits.'); }
        hash.update(value);
      }
    } finally { reader.releaseLock(); }
    if (observed !== object.size) throw new InvalidRecording('Recording is incomplete.');
    let audio:ReturnType<typeof validateWave>;try{audio=validateWave(header.buffer, observed);}catch(error){throw new InvalidRecording(error instanceof Error?error.message:'Invalid audio.');}
    const result: PreparationResult = { ...audio, sourceKey: upload.object_key, sourceSha256, sourceBytes: upload.size, sha256: hash.digest('hex'), bytes: observed, audioKey, audioBytes: observed, originalTimeOffsetMs: 0 };
    const publication = db.prepare(`UPDATE processing_jobs SET state='ready',result=?,error=NULL,finished_at=? WHERE id=? AND attempt=? AND state='running' AND deadline>? AND ${active} AND EXISTS(SELECT 1 FROM uploads WHERE uploads.id=processing_jobs.upload_id AND (uploads.state='admitted' OR (uploads.state='validating' AND uploads.expires_at>?)))`).bind(JSON.stringify(result), Date.now(), id,attempt, Date.now(), Date.now());
    const [published] = await db.batch([publication, db.prepare("UPDATE uploads SET state='admitted',admitted_at=? WHERE id=? AND state='validating' AND EXISTS(SELECT 1 FROM processing_jobs WHERE id=? AND state='ready' AND result=?)").bind(Date.now(), job.upload_id, id, JSON.stringify(result)), transcriptionIntent(db, id)]);
    if (!published.meta.changes) { if (audioKey !== upload.object_key) await bucket.delete(audioKey); throw new Error('Preparation was cancelled or superseded.'); }
    return result;
  }
  async function rejectFailedVideos() {
    await db.prepare("UPDATE uploads SET state='rejected',expires_at=0 WHERE admitted_at IS NULL AND state='validating' AND EXISTS(SELECT 1 FROM processing_jobs WHERE processing_jobs.upload_id=uploads.id AND processing_jobs.state='failed' AND (processing_jobs.failure_kind='invalid' OR uploads.expires_at<=?))").bind(Date.now()).run();
  }
  async function fail(id: string, message = 'Recording preparation failed. Retry after cancellation completes.',attempt=0) {
    await db.prepare("UPDATE processing_jobs SET state='failed',dispatch_state='cancel_pending',error=?,finished_at=? WHERE id=? AND attempt=? AND state='running'").bind(message.slice(0, 200), Date.now(), id,attempt).run();
    await rejectFailedVideos();
  }
  async function cancelReview(owner: string, review: string) {
    await db.prepare("UPDATE processing_jobs SET dispatch_state=CASE WHEN state='queued' OR (state='cancelled' AND dispatch_state='cancelled') THEN 'cancelled' ELSE 'cancel_pending' END,state='cancelled',result=NULL,error=NULL,finished_at=? WHERE owner_id=? AND review_id=?").bind(Date.now(), owner, review).run();
  }
  return { reconcile, status, prepare, fail, cancelReview };
}

export { createBudgetLedger } from './budget';

export function createRuntimeProcessing(env: Environment & { PROCESSING?: Workflow<{ jobId: string; preparationAttempt?:number }> }) {
  return createProcessingModule(env,
    env.PROCESSING ? async (id,attempt) => { await env.PROCESSING!.createBatch([{ id:preparationAttemptId(id,attempt), params: { jobId: id,preparationAttempt:attempt } }]); } : undefined,
    env.PROCESSING ? async (id,attempt) => {
      if (env.MEDIA_PROCESSOR || (env.LOCAL_MEDIA_ADAPTER === 'http://127.0.0.1:8790' && env.AUTH_SECRET)) { const response = await mediaServiceRequest(env, `/operations/${preparationAttemptId(id,attempt)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error('Media cancellation pending.'); }
      if (env.MEDIA_PROCESSOR) {
        const transcript = await env.DB.prepare('SELECT id,paid_attempt FROM transcriptions WHERE job_id=?').bind(id).first<{id:string;paid_attempt:number}>();
        if (transcript) {
          const response = await mediaServiceRequest(env, `/compression/${transcriptionAttemptId(transcript.id,transcript.paid_attempt)}`, {method:'DELETE',signal:AbortSignal.timeout(5000)});
          if (!response.ok) throw new Error('Media cancellation pending.');
        }
      }
      try { const instance = await env.PROCESSING!.get(preparationAttemptId(id,attempt)); const status = await instance.status(); if (!['complete', 'terminated', 'errored'].includes(status.status)) await instance.terminate(); }
      catch (error) { if (!(error instanceof Error && /^instance\.not_found(?::|$)/.test(error.message))) throw error; }
    } : undefined,
  );
}
