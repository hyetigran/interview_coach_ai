import {confirmationCanRestart} from './confirmation-recovery';
import {z} from 'zod';
import {recoveryPlan} from '../lib/recovery';
import {createRuntimeSpeakers} from './speakers';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'CONTINUATION'>;
export class RecoveryError extends Error {constructor(public status:number,message:string){super(message);}}
export function createRecoveryModule(env:Environment) {
 const db=env.DB;
 async function applied(owner:string,review:string,actionId:string,targetId:string) {return db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='confirmation' AND target_id=? AND state='applied'").bind(actionId,owner,review,targetId).first();}
 async function dispatchAndStatus(owner:string,review:string) {const speakers=createRuntimeSpeakers(env);await speakers.reconcile();return speakers.status(owner,review);}

 async function retryConfirmation(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),targetId:z.string().min(1).max(120)}).strict().parse(input);
  if(value.actionId===value.targetId)throw new RecoveryError(400,'Use a new retry action.');
  const current=await db.prepare("SELECT input_revision,coaching_revision FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first<{input_revision:number;coaching_revision:number}>();if(!current)throw new RecoveryError(404,'Review not found.');
  const existing=await db.prepare('SELECT target_id,stage,state,input_revision,context_revision FROM recovery_requests WHERE id=? AND review_id=? AND owner_id=?').bind(value.actionId,review,owner).first<{target_id:string;stage:string;state:string;input_revision:number;context_revision:number}>();
  if(existing){if(existing.target_id!==value.targetId||existing.stage!=='confirmation')throw new RecoveryError(409,'This retry action was already used for different work.');if(existing.state==='applied'){return dispatchAndStatus(owner,review);}if(existing.input_revision!==current.input_revision||existing.context_revision!==current.coaching_revision)throw new RecoveryError(409,'The retry plan changed. Reload before retrying.');}
  const confirmation=await db.prepare("SELECT state,retry_attempts FROM speaker_confirmations WHERE id=? AND review_id=? AND owner_id=? AND revision=?").bind(value.targetId,review,owner,current.input_revision).first<{state:string;retry_attempts:number}>();if(!confirmation){if(await applied(owner,review,value.actionId,value.targetId))return dispatchAndStatus(owner,review);throw new RecoveryError(409,'Speaker confirmation changed. Reload before retrying.');}
  // Once downstream work exists its receipts must be reconciled by a staged
  // recovery plan. Never replace the identity of an already submitted operation.
  if(!await db.prepare(`SELECT 1 FROM speaker_confirmations WHERE id=? AND ${confirmationCanRestart('speaker_confirmations.id')}`).bind(value.targetId).first()){if(await applied(owner,review,value.actionId,value.targetId))return dispatchAndStatus(owner,review);throw new RecoveryError(409,'Existing analysis must be recovered before restarting confirmation.');}
  const plan=recoveryPlan([{stage:'confirmation',id:value.targetId,state:confirmation.state,attempts:confirmation.retry_attempts,receipt:'none',billing:'none',maximumUnits:0,current:true}],0);
  if(plan.steps[0].action!=='retry')throw new RecoveryError(409,plan.steps[0].reason);
  const results=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,input_revision,context_revision,created_at) SELECT ?,?,?,'confirmation',?,?,?,? WHERE EXISTS(SELECT 1 FROM speaker_confirmations s JOIN reviews r ON r.id=s.review_id WHERE s.id=? AND s.owner_id=? AND s.review_id=? AND s.state='failed' AND s.retry_attempts<3 AND r.lifecycle='active' AND r.input_revision=s.revision AND r.input_revision=? AND r.coaching_revision=? AND ${confirmationCanRestart('s.id')})`).bind(value.actionId,review,owner,value.targetId,current.input_revision,current.coaching_revision,Date.now(),value.targetId,owner,review,current.input_revision,current.coaching_revision),
   db.prepare(`UPDATE speaker_confirmations SET id=?,state='queued',dispatch_state='pending',dispatch_attempts=0,dispatch_started_at=0,deadline=0,retry_attempts=retry_attempts+1,context_revision=? WHERE id=? AND owner_id=? AND review_id=? AND state='failed' AND retry_attempts<3 AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND target_id=? AND stage='confirmation' AND state='pending') AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND input_revision=speaker_confirmations.revision AND coaching_revision=?) AND ${confirmationCanRestart('speaker_confirmations.id')}`).bind(value.actionId,current.coaching_revision,value.targetId,owner,review,value.actionId,owner,review,value.targetId,review,owner,current.coaching_revision),
   db.prepare("UPDATE grouping_runs SET state='outdated' WHERE id=? AND EXISTS(SELECT 1 FROM speaker_confirmations WHERE id=? AND owner_id=? AND review_id=?) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND stage='confirmation' AND target_id=? AND state='pending')").bind(value.targetId,value.actionId,owner,review,value.actionId,value.targetId),
   db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND owner_id=? AND review_id=? AND EXISTS(SELECT 1 FROM speaker_confirmations WHERE id=?)").bind(value.actionId,owner,review,value.actionId),
  ]);
  if(!results[1].meta.changes){const replay=await applied(owner,review,value.actionId,value.targetId);if(!replay)throw new RecoveryError(409,'The retry plan changed. Reload before retrying.');}
  return dispatchAndStatus(owner,review);
 }
 return {retryConfirmation};
}
