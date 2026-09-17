import {accountSlotAvailable} from './account-slot';
import {z} from 'zod';
import {RecoveryError} from './recovery';
import {createRuntimeProcessing} from './processing';
type Environment=Parameters<typeof createRuntimeProcessing>[0];
export function createPreparationRetry(env:Environment,processing=createRuntimeProcessing(env)) {
 const db=env.DB;
 async function retry(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),jobId:z.string().min(1).max(100),attempt:z.number().int().min(0).max(2)}).strict().parse(input);
  const current=await db.prepare("SELECT input_revision,coaching_revision FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first<{input_revision:number;coaching_revision:number}>();
  if(!current)throw new RecoveryError(404,'Review not found.');
  const saved=await db.prepare('SELECT * FROM recovery_requests WHERE id=?').bind(value.actionId).first<{stage:string;owner_id:string;review_id:string;target_id:string;target_attempt:number;state:string}>();
  if(saved){
   if(saved.stage!=='preparation'||saved.owner_id!==owner||saved.review_id!==review||saved.target_id!==value.jobId||saved.target_attempt!==value.attempt)throw new RecoveryError(409,'This retry action belongs to different work.');
   if(saved.state==='applied'){await processing.reconcile();return processing.status(owner,review);}
  }
  // Confirm termination of the previous Workflow before replacing its attempt.
  await processing.reconcile();
  const source=await db.prepare("SELECT u.object_key FROM processing_jobs p JOIN uploads u ON u.id=p.upload_id WHERE p.id=? AND p.owner_id=? AND p.review_id=? AND p.revision=? AND (u.state='admitted' OR (u.state='validating' AND u.expires_at>?))").bind(value.jobId,owner,review,current.input_revision,Date.now()).first<{object_key:string}>();
  if(!source||!await env.MEDIA.head(source.object_key))throw new RecoveryError(409,'The recording is unavailable or expired. Start a new review with the recording.');
  const eligible=`SELECT p.id FROM processing_jobs p JOIN reviews r ON r.id=p.review_id JOIN uploads u ON u.id=p.upload_id
   WHERE p.id=? AND p.owner_id=? AND p.review_id=? AND p.attempt=? AND p.attempt<2
   AND p.state='failed' AND p.failure_kind='retryable' AND p.dispatch_state='cancelled'
   AND r.lifecycle='active' AND r.input_revision=p.revision
   AND (u.state='admitted' OR (u.state='validating' AND u.expires_at>?))
   AND ${accountSlotAvailable('p.owner_id')}`;
  const args=[value.jobId,owner,review,value.attempt,Date.now()];
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,target_attempt,input_revision,context_revision,created_at) SELECT ?,?,?,'preparation',?,?,?,?,? WHERE EXISTS(${eligible})`).bind(value.actionId,review,owner,value.jobId,value.attempt,current.input_revision,current.coaching_revision,Date.now(),...args),
   db.prepare(`UPDATE processing_jobs SET attempt=attempt+1,recovery_action_id=?,state='queued',dispatch_state='pending',dispatch_attempts=0,dispatch_started_at=0,deadline=0,error=NULL,finished_at=NULL WHERE id IN (${eligible}) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND stage='preparation' AND target_id=? AND target_attempt=? AND state='pending')`).bind(value.actionId,...args,value.actionId,value.jobId,value.attempt),
   db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND EXISTS(SELECT 1 FROM processing_jobs WHERE recovery_action_id=? AND id=? AND attempt=?)").bind(value.actionId,value.actionId,value.jobId,value.attempt+1),
  ]);
  if(!await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='preparation' AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.jobId,value.attempt).first())throw new RecoveryError(409,'Retry is unavailable: cancellation is pending, another job is active, the attempt limit is reached, or the recording changed.');
  await processing.reconcile();return processing.status(owner,review);
 }
 return {retry};
}
