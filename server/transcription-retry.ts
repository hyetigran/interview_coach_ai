import {z} from 'zod';
import {RecoveryError} from './recovery';
import {transcriptionAttemptId,TRANSCRIPTION_RESERVATION} from '../lib/transcription-attempt';
import type {PreparationResult} from './processing';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'OPENAI_API_KEY'>;
type Dispatch=(id:string,jobId:string,attempt:number)=>Promise<void>;
export function createTranscriptionRetry(env:Environment,dispatch?:Dispatch) {
 const db=env.DB;
 async function retry(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),transcriptId:z.string().min(1).max(100),attempt:z.number().int().min(0).max(2)}).strict().parse(input);
  const current=await db.prepare("SELECT input_revision,coaching_revision FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first<{input_revision:number;coaching_revision:number}>();
  if(!current)throw new RecoveryError(404,'Review not found.');
  const prior=await db.prepare('SELECT * FROM recovery_requests WHERE id=?').bind(value.actionId).first<{owner_id:string;review_id:string;stage:string;target_id:string;target_attempt:number;state:string}>();
  if(prior){
   if(prior.owner_id!==owner||prior.review_id!==review||prior.stage!=='transcription'||prior.target_id!==value.transcriptId||prior.target_attempt!==value.attempt)throw new RecoveryError(409,'This retry action belongs to different work.');
   if(prior.state==='applied'){await reconcile();return {accepted:true};}
  }
  if(!env.OPENAI_API_KEY)throw new RecoveryError(409,'Configure transcription access before retrying.');
  const row=await db.prepare("SELECT p.result FROM transcriptions t JOIN processing_jobs p ON p.id=t.job_id WHERE t.id=? AND t.owner_id=? AND t.review_id=? AND t.revision=? AND p.state='ready'").bind(value.transcriptId,owner,review,current.input_revision).first<{result:string}>();
  if(!row)throw new RecoveryError(409,'Prepared audio is unavailable.');
  const audio=JSON.parse(row.result) as PreparationResult;
  if(!await env.MEDIA.head(audio.audioKey??audio.sourceKey))throw new RecoveryError(409,'Prepared audio is unavailable.');
  const nextCall=transcriptionAttemptId(value.transcriptId,value.attempt+1);
  // Every statement repeats the current-input and account-slot checks. D1 batch
  // serializes reservation and queue publication in one transaction.
  const eligible=`SELECT t.id FROM transcriptions t JOIN reviews r ON r.id=t.review_id
   WHERE t.id=? AND t.owner_id=? AND t.review_id=? AND t.paid_attempt=? AND t.paid_attempt<2
   AND t.state IN ('failed','configuration','budget_blocked','reconciliation_exhausted')
   AND r.lifecycle='active' AND r.input_revision=t.revision
   AND NOT EXISTS(SELECT 1 FROM processing_budget WHERE id=CASE WHEN t.paid_attempt=0 THEN t.id ELSE t.id||'-attempt-'||t.paid_attempt END AND state='reserved')
   AND NOT EXISTS(SELECT 1 FROM processing_jobs WHERE owner_id=t.owner_id AND (state='running' OR dispatch_state='cancel_pending'))
   AND NOT EXISTS(SELECT 1 FROM transcriptions b WHERE b.owner_id=t.owner_id AND b.state IN ('queued','encoding','submitting','publishing'))
   AND NOT EXISTS(SELECT 1 FROM speaker_confirmations WHERE owner_id=t.owner_id AND state IN ('queued','running'))
   AND NOT EXISTS(SELECT 1 FROM grouping_runs WHERE owner_id=t.owner_id AND state='running')
   AND NOT EXISTS(SELECT 1 FROM coaching_runs WHERE owner_id=t.owner_id AND state IN ('queued','running'))`;
  const args=[value.transcriptId,owner,review,value.attempt];
  const pending="EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND state='pending' AND stage='transcription' AND target_id=? AND target_attempt=?)";
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,target_attempt,input_revision,context_revision,created_at) SELECT ?,?,?,'transcription',?,?,?,?,? WHERE EXISTS(${eligible})`).bind(value.actionId,review,owner,value.transcriptId,value.attempt,current.input_revision,current.coaching_revision,Date.now(),...args),
   db.prepare(`INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units) SELECT ?,'openai-diarization-v1',? WHERE EXISTS(${eligible}) AND ${pending} AND COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+?<=50000000`).bind(nextCall,TRANSCRIPTION_RESERVATION,...args,value.actionId,value.transcriptId,value.attempt,TRANSCRIPTION_RESERVATION),
   db.prepare(`UPDATE transcriptions SET paid_attempt=paid_attempt+1,recovery_action_id=?,state='queued',error=NULL,result_key=NULL,request_id=NULL,started_at=NULL,finished_at=NULL,publication_attempts=0,publication_deadline=0,publication_checked_at=0 WHERE id IN (${eligible}) AND ${pending} AND EXISTS(SELECT 1 FROM processing_budget WHERE id=? AND state='reserved')`).bind(value.actionId,...args,value.actionId,value.transcriptId,value.attempt,nextCall),
   db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND EXISTS(SELECT 1 FROM transcriptions WHERE recovery_action_id=? AND id=? AND paid_attempt=?)").bind(value.actionId,value.actionId,value.transcriptId,value.attempt+1),
  ]);
  const accepted=await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='transcription' AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.transcriptId,value.attempt).first();
  if(!accepted)throw new RecoveryError(409,'Retry is unavailable: another job is active, the allowance is insufficient, or the transcription changed. Reload before retrying.');
  await reconcile();return {accepted:true};
 }
 async function reconcile() {
  // End only undispatched queued work. Claimed work retains its reservation.
  await db.batch([
   db.prepare("UPDATE transcriptions SET state='failed',error='Retry dispatch expired before transcription started.' WHERE state='queued' AND EXISTS(SELECT 1 FROM recovery_requests q WHERE q.id=transcriptions.recovery_action_id AND q.state='applied' AND q.dispatch_state<>'sent' AND q.created_at<?)").bind(Date.now()-15*60000),
   db.prepare("UPDATE processing_budget SET state='settled',settled_units=0 WHERE state='reserved' AND EXISTS(SELECT 1 FROM transcriptions t JOIN recovery_requests q ON q.id=t.recovery_action_id WHERE processing_budget.id=t.id||'-attempt-'||t.paid_attempt AND t.state='failed' AND q.dispatch_state<>'sent' AND q.created_at<?)").bind(Date.now()-15*60000),
  ]);
  if(!dispatch)return;
  const rows=(await db.prepare("SELECT q.id,t.job_id,t.paid_attempt FROM recovery_requests q JOIN transcriptions t ON t.recovery_action_id=q.id JOIN reviews r ON r.id=t.review_id WHERE q.stage='transcription' AND q.state='applied' AND q.dispatch_state<>'sent' AND q.created_at>? AND q.dispatch_attempts<3 AND (q.dispatch_state='pending' OR q.dispatch_started_at<?) AND t.state='queued' AND r.lifecycle='active' AND r.input_revision=t.revision ORDER BY q.created_at LIMIT 10").bind(Date.now()-15*60000,Date.now()-60000).all<{id:string;job_id:string;paid_attempt:number}>()).results;
  for(const row of rows){
   const claim=await db.prepare("UPDATE recovery_requests SET dispatch_state='sending',dispatch_started_at=?,dispatch_attempts=dispatch_attempts+1 WHERE id=? AND dispatch_attempts<3 AND (dispatch_state='pending' OR dispatch_started_at<?)").bind(Date.now(),row.id,Date.now()-60000).run();if(!claim.meta.changes)continue;
   try{await dispatch('recovery-'+row.id,row.job_id,row.paid_attempt);await db.prepare("UPDATE recovery_requests SET dispatch_state='sent' WHERE id=?").bind(row.id).run();}catch{/* Retry the same Workflow identity after its dispatch lease expires. */}
  }
 }
 return {retry,reconcile};
}
export function createRuntimeTranscriptionRetry(env:Environment & {PROCESSING?:Workflow<{jobId:string;attempt?:number}>}) {
 return createTranscriptionRetry(env,env.PROCESSING?async(id,jobId,attempt)=>{await env.PROCESSING!.createBatch([{id,params:{jobId,attempt}}]);}:undefined);
}
