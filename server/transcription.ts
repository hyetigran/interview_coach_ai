import {providerConfigured} from './provider-configuration';
import {mediaServiceRequest} from './media-service';
import {accountSlotAvailable} from './account-slot';
import {reconcileProviderBilling} from './historical-billing';
import {transcriptionAttemptId,TRANSCRIPTION_RESERVATION} from '../lib/transcription-attempt';
import {recoveryPlan} from '../lib/recovery';
import { z } from 'zod';
import { createBudgetLedger } from './budget';
import type { PreparationResult } from './processing';
import { parseTranscript, type Transcript } from '../lib/transcript';
type Environment = Pick<CloudflareEnv, 'DB' | 'MEDIA' | 'AUTH_SECRET' | 'OPENAI_API_KEY'|'OPENAI_JOBS_CONFIGURED' | 'LOCAL_MEDIA_ADAPTER' | 'MEDIA_PROCESSOR'>;
type Row = { publication_retries:number; id: string; review_id: string; owner_id: string; job_id: string; revision: number; state: string; result_key: string | null; error: string | null; parent_id:string|null; publication_attempts:number; publication_deadline:number;paid_attempt:number };
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
    const billing=await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(transcriptionAttemptId(row.id,row.paid_attempt)).first<{state:'reserved'|'settled'}>();
    const used=await db.prepare("SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END),0) AS units FROM processing_budget").first<{units:number}>();
    const saved=['unknown','reconciliation','reconciliation_exhausted'].includes(row.state)?await env.MEDIA.head(`transcripts/${row.review_id}/${transcriptionAttemptId(row.id,row.paid_attempt)}.provider.json`):null;
    const step=recoveryPlan([{stage:'transcription',id:row.id,state:row.state,attempts:row.paid_attempt+1,receipt:saved?'complete':'none',billing:billing?.state??'none',maximumUnits:TRANSCRIPTION_RESERVATION,current:true}],50000000-(used?.units??0)).steps[0];
    const paidRetry={canRetry:step.action==='retry'&&providerConfigured(env),reason:!providerConfigured(env)?'Configure transcription access before retrying.':step.reason,maximumUnits:step.maximumUnits,attempt:row.paid_attempt};
    const retry=saved?{canRetry:row.state==='reconciliation_exhausted'&&row.publication_retries<2,reason:row.publication_retries>=2?'Saved transcription publication reached its three-window limit. The receipt is retained.':'Publish the saved transcription without another provider request.',maximumUnits:0,attempt:row.paid_attempt,publicationCycle:row.publication_retries}:paidRetry;
    return { id: row.id,retry, parentId:row.parent_id, revision:row.revision, state: row.state, error: row.error, transcript: object ? await object.json<Transcript>() : null };
  }
  async function run(jobId: string, expectedAttempt?:number) {
    const id = 'transcript-' + jobId; const row = await live(id);
    if (!row || row.state !== 'queued' || (expectedAttempt!==undefined && row.paid_attempt!==expectedAttempt)) return;
    if (!env.OPENAI_API_KEY) { await db.prepare("UPDATE transcriptions SET state='configuration',error='Transcription is not configured. Add OPENAI_API_KEY to .env and restart the local app.' WHERE id=? AND paid_attempt=? AND state='queued'").bind(id,row.paid_attempt).run(); await db.prepare("UPDATE processing_budget SET state='settled',settled_units=0 WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM transcriptions WHERE id=? AND paid_attempt=? AND state='configuration')").bind(transcriptionAttemptId(id,row.paid_attempt),id,row.paid_attempt).run(); return; }
    const claim = await db.prepare(`UPDATE transcriptions SET state='encoding',started_at=? WHERE id=? AND paid_attempt=? AND state='queued' AND ${active}`).bind(Date.now(), id,row.paid_attempt).run();
    if (!claim.meta.changes) return;
    const call=transcriptionAttemptId(id,row.paid_attempt);
    let submitted = false; let receiptSaved = false;
    try {
      const preparation = await db.prepare("SELECT result FROM processing_jobs WHERE id=? AND state='ready'").bind(jobId).first<{ result: string }>();
      if (!preparation) throw new Error('Prepared audio is unavailable.');
      const audio = JSON.parse(preparation.result) as PreparationResult;
      const object = await env.MEDIA.get(audio.audioKey ?? audio.sourceKey);
      if (!object) throw new Error('Prepared audio is unavailable.');
      const encoded = await mediaServiceRequest(env, `/compression/${call}`, { method: 'POST', body: object.body, signal: AbortSignal.timeout(80000) }, request);
      if (!encoded.ok || Number(encoded.headers.get('content-length')) > 15000000) throw new Error('Unable to prepare audio for transcription.');
      const bytes = await encoded.arrayBuffer(); if (bytes.byteLength > 15000000 || !bytes.byteLength) throw new Error('Compressed audio is invalid.');
      // Conservative local policy reservation, not a provider-enforced price ceiling.
      // Unknown billing retains this amount and is never retried automatically.
      const maximum = TRANSCRIPTION_RESERVATION;
      if (!await budget.reserve(call, 'openai-diarization-v1', maximum)) { await db.prepare("UPDATE transcriptions SET state='budget_blocked',error='The processing allowance cannot cover this transcription.' WHERE id=? AND paid_attempt=? AND state='encoding'").bind(id,row.paid_attempt).run(); return; }
      const permission = await db.prepare(`UPDATE transcriptions SET state='submitting' WHERE id=? AND paid_attempt=? AND state='encoding' AND ${active}`).bind(id,row.paid_attempt).run();
      if (!permission.meta.changes) { await budget.settle(call, 0); return; }
      const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/mpeg' }), 'interview.mp3'); form.set('model', 'gpt-4o-transcribe-diarize'); form.set('response_format', 'diarized_json'); form.set('chunking_strategy', 'auto'); form.set('language', 'en');
      submitted = true;
      const response = await request('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'X-Client-Request-Id': call }, body: form, signal: AbortSignal.timeout(15 * 60000) });
      if (!response.ok) {
        if ([400, 401, 403, 413, 429].includes(response.status)) { await budget.settle(call, 0); submitted = false; }
        throw new Error(response.status === 429 ? 'OpenAI quota or rate limit reached. Check the API project billing.' : 'OpenAI could not complete transcription.');
      }
      const raw = await response.text(); if (new TextEncoder().encode(raw).length > 8000000) throw new Error('Transcript response exceeds supported limits.');
      const receiptKey = `transcripts/${row.review_id}/${transcriptionAttemptId(id,row.paid_attempt)}.provider.json`;
      if ((await live(id))?.paid_attempt===row.paid_attempt) {
        await env.MEDIA.put(receiptKey, JSON.stringify({ requestId: response.headers.get('x-request-id'), response: raw }), { httpMetadata: { contentType: 'application/json' } });
        receiptSaved = true;
        await db.prepare('UPDATE transcriptions SET request_id=? WHERE id=? AND paid_attempt=?').bind(response.headers.get('x-request-id'), id,row.paid_attempt).run();
        if ((await live(id))?.paid_attempt!==row.paid_attempt) await env.MEDIA.delete(receiptKey);
      }
      await publish(row,audio,JSON.parse(raw),'submitting');
    } catch {
      await db.prepare(`UPDATE transcriptions SET state=?,error=?,finished_at=? WHERE id=? AND paid_attempt=? AND state IN ('encoding','submitting') AND ${active}`).bind(receiptSaved ? 'reconciliation' : submitted ? 'unknown' : 'failed', receiptSaved ? 'OpenAI returned a result, which is safely stored. Its format or billing needs reconciliation before publication.' : submitted ? 'The paid transcription outcome needs reconciliation. It will not be submitted again automatically.' : 'Transcription could not start. Check local services, API access, and billing.', Date.now(), id,row.paid_attempt).run();
    }
    finally {
      if(!submitted&&!receiptSaved)await db.prepare("UPDATE processing_budget SET state='settled',settled_units=0 WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM transcriptions WHERE id=? AND paid_attempt=? AND state IN ('failed','configuration','cancelled'))").bind(call,id,row.paid_attempt).run();
    }
  }
  async function publish(row:Row,audio:PreparationResult,data:unknown,state:'submitting'|'publishing',attempt=0) {
    const usage=z.object({usage:z.object({type:z.literal('tokens'),input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()})}).safeParse(data);
    if(usage.success)await budget.settle(transcriptionAttemptId(row.id,row.paid_attempt),Math.ceil(usage.data.usage.input_tokens*2.5+usage.data.usage.output_tokens*10));
    const {transcript}=parseTranscript(data,row.id,audio.sha256,audio.durationMs);
    const current=await live(row.id);if(!current||current.state!==state||current.paid_attempt!==row.paid_attempt||(state==='publishing'&&current.publication_attempts!==attempt))return;
    const resultKey=`transcripts/${row.review_id}/${transcriptionAttemptId(row.id,row.paid_attempt)}.json`;
    await env.MEDIA.put(resultKey,JSON.stringify(transcript),{httpMetadata:{contentType:'application/json'}});
    const published=await db.prepare(`UPDATE transcriptions SET state='ready',result_key=?,finished_at=?,error=NULL WHERE id=? AND paid_attempt=? AND state=? AND (state<>'publishing' OR (publication_attempts=? AND publication_deadline>?)) AND ${active}`).bind(resultKey,Date.now(),row.id,row.paid_attempt,state,attempt,Date.now()).run();
    // A losing publication must not delete another publisher's identical result.
    if(!published.meta.changes&&!await live(row.id))await env.MEDIA.delete(resultKey);
  }
  async function recoverReceipt(id:string) {
    const row=await live(id);if(!row||!['reconciliation','unknown'].includes(row.state))return;
    await db.prepare(`UPDATE transcriptions SET publication_checked_at=? WHERE id=? AND ${active}`).bind(Date.now(),id).run();
    const receipt=await env.MEDIA.get(`transcripts/${row.review_id}/${transcriptionAttemptId(id,row.paid_attempt)}.provider.json`);if(!receipt)return;
    const now=Date.now();
    const claim=await db.prepare(`UPDATE transcriptions SET state='publishing',started_at=?,publication_attempts=publication_attempts+1,publication_deadline=CASE WHEN publication_deadline=0 THEN ? ELSE publication_deadline END WHERE id=? AND paid_attempt=? AND state IN ('reconciliation','unknown') AND publication_attempts<3 AND (publication_deadline=0 OR publication_deadline>?) AND ${active} AND ${accountSlotAvailable('transcriptions.owner_id','transcriptions.review_id')} RETURNING publication_attempts`).bind(now,now+15*60000,id,row.paid_attempt,now).first<{publication_attempts:number}>();
    if(!claim)return;
    try {
      const saved=z.object({response:z.string().max(8000000)}).parse(await receipt.json());
      const preparation=await db.prepare("SELECT result FROM processing_jobs WHERE id=? AND state='ready'").bind(row.job_id).first<{result:string}>();if(!preparation)throw new Error('Prepared audio unavailable.');
      await publish(row,JSON.parse(preparation.result),JSON.parse(saved.response),'publishing',claim.publication_attempts);
    } catch {
      await db.prepare(`UPDATE transcriptions SET state=CASE WHEN publication_attempts>=3 OR publication_deadline<=? THEN 'reconciliation_exhausted' ELSE 'reconciliation' END,error='The saved transcription could not be published. Its receipt is retained; unresolved charges stay reserved and no new provider request was sent.' WHERE id=? AND paid_attempt=? AND state='publishing' AND publication_attempts=? AND ${active}`).bind(Date.now(),id,row.paid_attempt,claim.publication_attempts).run();
    }
  }
  async function cleanup() {
    await db.prepare(`UPDATE processing_budget SET state='settled',settled_units=0 WHERE state='reserved' AND EXISTS(SELECT 1 FROM transcriptions WHERE processing_budget.id=CASE WHEN paid_attempt=0 THEN transcriptions.id ELSE transcriptions.id||'-attempt-'||paid_attempt END AND ((state IN ('queued','encoding') AND NOT ${active}) OR state IN ('failed','configuration')))` ).run();
    await db.prepare(`UPDATE transcriptions SET state='cancelled',error=NULL,result_key=NULL WHERE state<>'cancelled' AND ((state<>'ready' AND NOT ${active}) OR NOT EXISTS(SELECT 1 FROM reviews WHERE reviews.id=transcriptions.review_id AND reviews.lifecycle='active'))`).run();
    const cancelled = (await db.prepare("SELECT review_id,id FROM transcriptions WHERE state='cancelled'").all<{ review_id: string; id: string }>()).results;
    for(const row of cancelled)await env.MEDIA.delete([0,1,2].flatMap(attempt=>{const call=transcriptionAttemptId(row.id,attempt);return [`transcripts/${row.review_id}/${call}.json`,`transcripts/${row.review_id}/${call}.provider.json`];}));
    await db.prepare("UPDATE transcriptions SET state=CASE WHEN publication_attempts>=3 OR publication_deadline<=? THEN 'reconciliation_exhausted' ELSE 'reconciliation' END,error='Saved-result publication was interrupted; no provider request was repeated.' WHERE state='publishing' AND started_at<?").bind(Date.now(),Date.now()-5*60000).run();
    await db.prepare("UPDATE transcriptions SET state='reconciliation_exhausted',error='Saved-result recovery reached its limit. The receipt and unresolved billing reservation are retained.' WHERE state='reconciliation' AND (publication_attempts>=3 OR (publication_deadline>0 AND publication_deadline<=?))").bind(Date.now()).run();
    await db.prepare("UPDATE transcriptions SET state='failed',error='Audio encoding was interrupted before provider submission. Retry can reuse the prepared recording.' WHERE state='encoding' AND started_at<?").bind(Date.now()-20*60000).run();
    // A process crash after submitting cannot trigger another paid request.
    await db.prepare("UPDATE transcriptions SET state='unknown',error='The transcription was interrupted. Billing and outcome need reconciliation.' WHERE state='submitting' AND started_at<?").bind(Date.now() - 20 * 60000).run();
  }
  async function reconcileReceipts() {
    await reconcileProviderBilling(env);
    await cleanup();
    const rows=(await db.prepare(`SELECT id FROM transcriptions WHERE state IN ('reconciliation','unknown') AND publication_attempts<3 AND (publication_deadline=0 OR publication_deadline>?) AND ${active} ORDER BY publication_checked_at,id LIMIT 10`).bind(Date.now()).all<{id:string}>()).results;
    for(const row of rows){try{await recoverReceipt(row.id);}catch{/* A temporary storage failure cannot starve other saved results. */}}
  }
  return { run, status, cleanup, recoverReceipt, reconcileReceipts };
}
