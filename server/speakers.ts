import {reconcileProviderBilling} from './historical-billing';
import {accountSlotAvailable} from './account-slot';
import {confirmationCanRestart} from './confirmation-recovery';
import { z } from 'zod';
import { transcriptSchema } from '../lib/transcript';
type Environment = Pick<CloudflareEnv, 'DB' | 'MEDIA'>;
type Row = { id: string; review_id: string; owner_id: string; transcript_id: string; speakers: string; revision: number; state: string; dispatch_state: string; retry_attempts:number };
const active = "EXISTS(SELECT 1 FROM reviews JOIN transcriptions ON transcriptions.review_id=reviews.id WHERE reviews.id=speaker_confirmations.review_id AND reviews.owner_id=speaker_confirmations.owner_id AND reviews.lifecycle='active' AND reviews.input_revision=speaker_confirmations.revision AND transcriptions.id=speaker_confirmations.transcript_id AND transcriptions.state='ready' AND transcriptions.revision=speaker_confirmations.revision)";
const inputSchema = z.object({ actionId: z.uuid(), transcriptId: z.string().min(1).max(120), speakers: z.array(z.string().min(1).max(120)).min(1).max(100) }).strict();
export class SpeakerError extends Error { constructor(public status: number, message: string) { super(message); } }
export function createSpeakerModule(env: Environment, dispatch?: (id: string) => Promise<void>) {
  const db = env.DB;
  async function status(owner: string, review: string) {
    const row = await db.prepare(`SELECT * FROM speaker_confirmations WHERE owner_id=? AND review_id=? AND ${active}`).bind(owner,review).first<Row>();
    const canRetry=!!row&&row.state==='failed'&&row.retry_attempts<3&&!!await db.prepare(`SELECT 1 FROM speaker_confirmations WHERE id=? AND ${confirmationCanRestart('speaker_confirmations.id')}`).bind(row.id).first();
    return row ? { id: row.id, transcriptId: row.transcript_id, speakers: JSON.parse(row.speakers) as string[], state: row.state,canRetry } : null;
  }
  async function confirm(owner: string, review: string, input: unknown) {
    const value = inputSchema.parse(input); const speakers = [...new Set(value.speakers)].sort();
    const transcript = await db.prepare("SELECT transcriptions.result_key,transcriptions.revision FROM transcriptions JOIN reviews ON reviews.id=transcriptions.review_id WHERE transcriptions.id=? AND transcriptions.review_id=? AND transcriptions.owner_id=? AND transcriptions.state='ready' AND reviews.lifecycle='active' AND reviews.input_revision=transcriptions.revision").bind(value.transcriptId,review,owner).first<{ result_key: string; revision: number }>();
    if (!transcript) throw new SpeakerError(409,'The transcript changed or is unavailable. Reload before confirming your voice.');
    const object = await env.MEDIA.get(transcript.result_key); if (!object) throw new SpeakerError(409,'The transcript is unavailable.');
    const document = transcriptSchema.parse(await object.json()); const labels = new Set(document.utterances.map(utterance => utterance.speaker).filter(Boolean));
    if (speakers.some(speaker => !labels.has(speaker))) throw new SpeakerError(400,'Select only speaker labels present in this transcript.');
    const manual=await db.prepare("SELECT candidate_speakers,manual_review FROM transcript_correction_intents WHERE id=? AND state='published' AND manual_groups IS NOT NULL").bind(value.transcriptId).first<{candidate_speakers:string;manual_review:number}>();
    if(manual?.manual_review)throw new SpeakerError(409,'Review saved question groups before confirming your voice or refreshing analysis.');
    if(manual&&JSON.stringify(JSON.parse(manual.candidate_speakers).sort())!==JSON.stringify(speakers))throw new SpeakerError(409,'Use speaker-role corrections to change attribution while preserving your saved question groups.');
    await db.prepare("INSERT OR IGNORE INTO speaker_confirmations(id,review_id,owner_id,transcript_id,speakers,revision,confirmed_at,context_revision) SELECT ?,?,?,?,?,?,?,(SELECT coaching_revision FROM reviews WHERE id=?) WHERE EXISTS(SELECT 1 FROM reviews JOIN transcriptions ON reviews.id=transcriptions.review_id WHERE reviews.id=? AND reviews.owner_id=? AND reviews.lifecycle='active' AND reviews.input_revision=? AND transcriptions.id=? AND transcriptions.state='ready' AND transcriptions.revision=reviews.input_revision)").bind(value.actionId,review,owner,value.transcriptId,JSON.stringify(speakers),transcript.revision,Date.now(),review,review,owner,transcript.revision,value.transcriptId).run();
    const saved = await status(owner,review);
    if (!saved || saved.transcriptId !== value.transcriptId || JSON.stringify(saved.speakers) !== JSON.stringify(speakers)) throw new SpeakerError(409,'A different confirmation was saved or the transcript changed. Reload to see the current selection.');
    await reconcile(); return await status(owner,review);
  }
  async function reconcile() {
    await reconcileProviderBilling(env);
    await db.prepare(`UPDATE speaker_confirmations SET state='outdated' WHERE state NOT IN ('cancelled','outdated') AND NOT ${active} AND EXISTS(SELECT 1 FROM reviews WHERE reviews.id=speaker_confirmations.review_id AND lifecycle='active')`).run();
    await db.prepare("UPDATE speaker_confirmations SET state='cancelled',speakers='[]' WHERE state<>'cancelled' AND NOT EXISTS(SELECT 1 FROM reviews WHERE reviews.id=speaker_confirmations.review_id AND lifecycle='active')").run();
    await db.prepare("UPDATE speaker_confirmations SET state='failed' WHERE state='running' AND deadline<=?").bind(Date.now()).run();
    if (!dispatch) return;
    const rows = (await db.prepare("SELECT * FROM speaker_confirmations WHERE state='queued' OR (state='running' AND dispatch_state='pending') ORDER BY confirmed_at LIMIT 25").all<Row>()).results;
    for (const row of rows) {
      if (row.state === 'queued') {
        const claim = await db.prepare(`UPDATE speaker_confirmations SET state='running',deadline=? WHERE id=? AND state='queued' AND ${active} AND ${accountSlotAvailable('speaker_confirmations.owner_id')}`).bind(Date.now()+300000,row.id).run();
        if (!claim.meta.changes) continue;
      }
      const delivery=await db.prepare(`UPDATE speaker_confirmations SET dispatch_attempts=dispatch_attempts+1,dispatch_started_at=? WHERE id=? AND state='running' AND dispatch_state='pending' AND deadline>? AND dispatch_attempts<3 AND dispatch_started_at<? AND ${active}`).bind(Date.now(),row.id,Date.now(),Date.now()-60000).run();
      if(!delivery.meta.changes)continue;
      try { await dispatch(row.id); await db.prepare("UPDATE speaker_confirmations SET dispatch_state='sent' WHERE id=? AND state='running'").bind(row.id).run(); } catch { /* Persisted intent retries the same workflow identity. */ }
    }
  }
  async function resume(id: string) {
    // Only persisted, current confirmation can authorize downstream work. An event
    // payload or elapsed waiting time cannot create candidate attribution.
    const row = await db.prepare(`UPDATE speaker_confirmations SET state='confirmed' WHERE id=? AND (state='confirmed' OR (state='running' AND deadline>?)) AND ${active} RETURNING *`).bind(id,Date.now()).first<Row>();
    if (!row) return null;
    return { reviewId: row.review_id, transcriptId: row.transcript_id, speakers: JSON.parse(row.speakers) as string[], revision: row.revision };
  }
  return { status, confirm, reconcile, resume };
}
export function createRuntimeSpeakers(env: Environment & { CONTINUATION?: Workflow<{ confirmationId: string; coachingRunId?: string }> }) {
  return createSpeakerModule(env, env.CONTINUATION ? async id => { await env.CONTINUATION!.createBatch([{ id: 'continue-'+id, params: { confirmationId: id } }]); } : undefined);
}
