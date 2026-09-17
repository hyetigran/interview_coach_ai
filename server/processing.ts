import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateWave } from './audio-format';
import { MAX_AUDIO_BYTES } from '../lib/media/contracts';
type Environment = { DB: D1Database; MEDIA: R2Bucket; LOCAL_MEDIA_ADAPTER?: string; AUTH_SECRET?: string };
type Job = { id: string; review_id: string; owner_id: string; upload_id: string; state: string; dispatch_state: string; revision: number; deadline: number; result: string | null; error: string | null };
const active = "EXISTS(SELECT 1 FROM reviews WHERE reviews.id=processing_jobs.review_id AND reviews.owner_id=processing_jobs.owner_id AND reviews.lifecycle='active' AND reviews.input_revision=processing_jobs.revision)";
export type PreparationResult = { sourceKey: string; sourceSha256?: string; sourceBytes?: number; sha256: string; bytes: number; durationMs: number; channels: number; sampleRate: number; audioKey?: string; audioBytes?: number; originalTimeOffsetMs?: number };
export function initialJobStatement(db: D1Database, uploadId: string) {
  return db.prepare("INSERT OR IGNORE INTO processing_jobs(id,review_id,owner_id,upload_id,revision,created_at) SELECT 'prepare-'||uploads.id,uploads.review_id,uploads.owner_id,uploads.id,reviews.input_revision,? FROM uploads JOIN reviews ON reviews.id=uploads.review_id WHERE uploads.id=? AND uploads.state IN ('admitted','validating') AND reviews.lifecycle='active'").bind(Date.now(), uploadId);
}
export function createProcessingModule(env: Environment, dispatch?: (id: string) => Promise<void>, terminate?: (id: string) => Promise<void>) {
  const { DB: db, MEDIA: bucket } = env;
  async function reconcile() {
    if (terminate) {
      const cancelled = (await db.prepare("SELECT id FROM processing_jobs WHERE state IN ('cancelled','failed') AND dispatch_state='cancel_pending' ORDER BY COALESCE(cancellation_attempted_at,0),id LIMIT 25").all<{ id: string }>()).results;
      for (const job of cancelled) { await db.prepare('UPDATE processing_jobs SET cancellation_attempted_at=? WHERE id=?').bind(Date.now(), job.id).run(); try { await terminate(job.id); await db.prepare("UPDATE processing_jobs SET dispatch_state='cancelled' WHERE id=? AND state IN ('cancelled','failed')").bind(job.id).run(); } catch { /* Retry cancellation without exposing content. */ } }
    }
    await db.prepare(`UPDATE processing_jobs SET dispatch_state=CASE WHEN state='queued' OR (state='cancelled' AND dispatch_state='cancelled') THEN 'cancelled' ELSE 'cancel_pending' END,state='cancelled',result=NULL,error=NULL,finished_at=? WHERE state IN ('queued','running') AND NOT ${active}`).bind(Date.now()).run();
    await db.prepare("UPDATE processing_jobs SET state='failed',dispatch_state='cancel_pending',error='Preparation timed out. Retry will be available in the recovery update.',finished_at=? WHERE state='running' AND deadline<=?").bind(Date.now(), Date.now()).run();
    await rejectFailedVideos();
    if (!dispatch) return;
    const jobs = (await db.prepare("SELECT * FROM processing_jobs WHERE state='queued' OR (state='running' AND dispatch_state='pending') ORDER BY created_at,id LIMIT 25").all<Job>()).results;
    for (const job of jobs) {
      if (job.state === 'queued') {
        const claimed = await db.prepare(`UPDATE processing_jobs SET state='running',deadline=? WHERE id=? AND state='queued' AND ${active} AND NOT EXISTS(SELECT 1 FROM processing_jobs AS busy WHERE busy.owner_id=processing_jobs.owner_id AND busy.state='running')`).bind(Date.now() + 5 * 60000, job.id).run();
        if (!claimed.meta.changes) continue;
      }
      try {
        // createBatch uses this stable ID idempotently, including after a lost response.
        await dispatch(job.id);
        await db.prepare("UPDATE processing_jobs SET dispatch_state='sent' WHERE id=? AND state='running'").bind(job.id).run();
      } catch { /* Intent remains pending; a scheduled reconciler retries the same ID. */ }
    }
  }
  async function status(owner: string, review: string) {
    const job = await db.prepare('SELECT * FROM processing_jobs WHERE review_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 1').bind(review, owner).first<Job>();
    if (!job) return null;
    return { id: job.id, state: job.state, error: job.error, result: job.result ? JSON.parse(job.result) as PreparationResult : null };
  }
  async function live(id: string) {
    const job = await db.prepare(`SELECT * FROM processing_jobs WHERE id=? AND state='running' AND deadline>? AND ${active}`).bind(id, Date.now()).first<Job>();
    if (!job) throw new Error('Preparation is no longer active.'); return job;
  }
  async function prepare(id: string): Promise<PreparationResult> {
    const existing = await db.prepare(`SELECT result FROM processing_jobs WHERE id=? AND state='ready' AND ${active}`).bind(id).first<{ result: string }>();
    if (existing) return JSON.parse(existing.result);
    const job = await live(id);
    const upload = await db.prepare("SELECT object_key,size,name FROM uploads WHERE id=? AND review_id=? AND state IN ('admitted','validating')").bind(job.upload_id, job.review_id).first<{ object_key: string; size: number; name: string }>();
    if (!upload) throw new Error('Recording is not available.');
    let audioKey = upload.object_key;
    const original = await bucket.get(upload.object_key);
    if (!original || original.size !== upload.size || original.size > MAX_AUDIO_BYTES) throw new Error('Recording is incomplete or too large.');
    const sourceHash = createHash('sha256'); const sourceReader = original.body.getReader(); let sourceBytes = 0;
    try { while (true) { const { done, value } = await sourceReader.read(); if (done) break; sourceBytes += value.byteLength; if (sourceBytes > MAX_AUDIO_BYTES || Date.now() >= job.deadline) { await sourceReader.cancel(); throw new Error('Recording exceeds preparation limits.'); } sourceHash.update(value); } } finally { sourceReader.releaseLock(); }
    if (sourceBytes !== upload.size) throw new Error('Recording is incomplete.');
    const sourceSha256 = sourceHash.digest('hex');
    if (!/\.wav$/i.test(upload.name)) {
      if (env.LOCAL_MEDIA_ADAPTER !== 'http://127.0.0.1:8790' || !env.AUTH_SECRET) throw new Error('Video preparation requires the local media service. Run pnpm dev.');
      const source = await bucket.get(upload.object_key);
      if (!source || source.size !== upload.size || source.size > MAX_AUDIO_BYTES) throw new Error('Recording is incomplete or too large.');
      const response = await fetch(`${env.LOCAL_MEDIA_ADAPTER}/operations/${id}`, { method: 'POST', headers: { authorization: `Bearer ${env.AUTH_SECRET}` }, body: source.body, signal: AbortSignal.timeout(80000) });
      if (!response.ok || !response.body) throw new Error((await response.text()).slice(0, 200) || 'Video preparation failed.');
      await live(id);
      audioKey = 'audio/' + job.upload_id + '/' + crypto.randomUUID();
      await bucket.put(audioKey, response.body, { httpMetadata: { contentType: 'audio/wav' } });
      try { await live(id); } catch (error) { await bucket.delete(audioKey); throw error; }
    }
    const object = await bucket.get(audioKey);
    if (!object || (audioKey === upload.object_key && object.size !== upload.size) || object.size > MAX_AUDIO_BYTES || object.httpMetadata?.contentType !== 'audio/wav') throw new Error('Recording size or media type is invalid.');
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
    if (observed !== object.size) throw new Error('Recording is incomplete.');
    const audio = validateWave(header.buffer, observed);
    const result: PreparationResult = { ...audio, sourceKey: upload.object_key, sourceSha256, sourceBytes: upload.size, sha256: hash.digest('hex'), bytes: observed, audioKey, audioBytes: observed, originalTimeOffsetMs: 0 };
    const publication = db.prepare(`UPDATE processing_jobs SET state='ready',result=?,error=NULL,finished_at=? WHERE id=? AND state='running' AND deadline>? AND ${active} AND EXISTS(SELECT 1 FROM uploads WHERE uploads.id=processing_jobs.upload_id AND (uploads.state='admitted' OR (uploads.state='validating' AND uploads.expires_at>?)))`).bind(JSON.stringify(result), Date.now(), id, Date.now(), Date.now());
    const [published] = await db.batch([publication, db.prepare("UPDATE uploads SET state='admitted',admitted_at=? WHERE id=? AND state='validating' AND EXISTS(SELECT 1 FROM processing_jobs WHERE id=? AND state='ready' AND result=?)").bind(Date.now(), job.upload_id, id, JSON.stringify(result))]);
    if (!published.meta.changes) { if (audioKey !== upload.object_key) await bucket.delete(audioKey); throw new Error('Preparation was cancelled or superseded.'); }
    return result;
  }
  async function rejectFailedVideos() {
    await db.prepare("UPDATE uploads SET state='rejected',expires_at=0 WHERE admitted_at IS NULL AND state='validating' AND EXISTS(SELECT 1 FROM processing_jobs WHERE processing_jobs.upload_id=uploads.id AND processing_jobs.state='failed')").run();
  }
  async function fail(id: string, message = 'Recording preparation failed. Retry will be available in the recovery update.') {
    await db.prepare("UPDATE processing_jobs SET state='failed',error=?,finished_at=? WHERE id=? AND state='running'").bind(message.slice(0, 200), Date.now(), id).run();
    await rejectFailedVideos();
  }
  async function cancelReview(owner: string, review: string) {
    await db.prepare("UPDATE processing_jobs SET dispatch_state=CASE WHEN state='queued' OR (state='cancelled' AND dispatch_state='cancelled') THEN 'cancelled' ELSE 'cancel_pending' END,state='cancelled',result=NULL,error=NULL,finished_at=? WHERE owner_id=? AND review_id=?").bind(Date.now(), owner, review).run();
  }
  return { reconcile, status, prepare, fail, cancelReview };
}

// Integer microdollars: $50 = 50,000,000 units. Unknown charges stay reserved.
export function createBudgetLedger(db: D1Database) {
  const amount = z.number().int().min(0).max(50000000);
  const key = z.string().min(1).max(120);
  async function reserve(id: string, operation: string, maximum: number) {
    key.parse(id); key.parse(operation); amount.parse(maximum);
    await db.prepare("INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units) SELECT ?,?,? WHERE COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+?<=50000000").bind(id, operation, maximum, maximum).run();
    const row = await db.prepare('SELECT reserved_units,operation,state FROM processing_budget WHERE id=?').bind(id).first<{ reserved_units: number; operation: string; state: string }>();
    if (row && (row.reserved_units !== maximum || row.operation !== operation)) throw new Error('Budget operation identity cannot be reused with different inputs.');
    return row?.state === 'reserved';
  }
  async function settle(id: string, actual: number) {
    key.parse(id); amount.parse(actual);
    const row = await db.prepare('SELECT reserved_units,settled_units,state FROM processing_budget WHERE id=?').bind(id).first<{ reserved_units: number; settled_units: number | null; state: string }>();
    if (!row || actual > row.reserved_units || (row.state === 'settled' && row.settled_units !== actual)) throw new Error('Charge does not match its reservation.');
    const update = await db.prepare("UPDATE processing_budget SET state='settled',settled_units=? WHERE id=? AND state='reserved'").bind(actual, id).run();
    if (!update.meta.changes) {
      const settled = await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(id).first<{ settled_units: number }>();
      if (settled?.settled_units !== actual) throw new Error('Budget operation was already settled differently.');
    }
  }
  return { reserve, settle };
}

export function createRuntimeProcessing(env: Environment & { PROCESSING?: Workflow<{ jobId: string }> }) {
  return createProcessingModule(env,
    env.PROCESSING ? async id => { await env.PROCESSING!.createBatch([{ id, params: { jobId: id } }]); } : undefined,
    env.PROCESSING ? async id => {
      if (env.LOCAL_MEDIA_ADAPTER === 'http://127.0.0.1:8790' && env.AUTH_SECRET) { const response = await fetch(`${env.LOCAL_MEDIA_ADAPTER}/operations/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${env.AUTH_SECRET}` }, signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error('Media cancellation pending.'); }
      try { const instance = await env.PROCESSING!.get(id); const status = await instance.status(); if (!['complete', 'terminated', 'errored'].includes(status.status)) await instance.terminate(); }
      catch (error) { if (!(error instanceof Error && /^instance\.not_found(?::|$)/.test(error.message))) throw error; }
    } : undefined,
  );
}
