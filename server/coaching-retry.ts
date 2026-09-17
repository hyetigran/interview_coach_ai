import {z} from 'zod';
import {RecoveryError} from './recovery';
import {createCoachingModule} from './coaching';
import {coachingAttemptId} from '../lib/coaching-attempt';
import {resolveCoaching,type CoachingSources} from '../lib/coaching';
import {structuredOutput,STRUCTURED_RESERVATION} from './openai-structured';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'OPENAI_API_KEY'>;
type Job={id:string;run_id:string;attempt:number;draft_attempt:number;state:string;sources:string|null;run_state:string;grouping_id:string};
type Dispatch=(actionId:string,groupingId:string)=>Promise<void>;
const current=`SELECT j.*,c.state AS run_state,c.grouping_id FROM coaching_jobs j JOIN coaching_runs c ON c.id=j.run_id JOIN reviews r ON r.id=c.review_id JOIN grouping_runs g ON g.id=c.grouping_id
 WHERE j.id=? AND c.owner_id=? AND c.review_id=? AND r.lifecycle='active' AND r.input_revision=c.revision AND r.coaching_revision=c.context_revision AND g.output_version=c.grouping_version AND g.state IN ('ready','partial')`;
export function createCoachingRetry(env:Environment,dispatch?:Dispatch) {
 const db=env.DB;
 async function inspect(owner:string,review:string,id:string){
  const job=await db.prepare(current).bind(id,owner,review).first<Job>();if(!job)return null;
  const draftReceipt=await env.MEDIA.get(`coaching/${review}/${coachingAttemptId(id,job.draft_attempt,'draft')}.provider.json`),verifyReceipt=await env.MEDIA.head(`coaching/${review}/${coachingAttemptId(id,job.attempt,'verify')}.provider.json`);
  let draft:string|null=null;
  if(draftReceipt&&job.sources){try{const saved=z.object({response:z.string().max(2000000)}).parse(await draftReceipt.json());draft=JSON.stringify(resolveCoaching(structuredOutput(JSON.parse(saved.response)),JSON.parse(job.sources) as CoachingSources));}catch{/* A structurally invalid draft requires explicit regeneration. */}}
  const reserved=await db.prepare("SELECT id FROM processing_budget WHERE id IN (?,?) AND state='reserved'").bind(coachingAttemptId(id,job.draft_attempt,'draft'),coachingAttemptId(id,job.attempt,'verify')).first();
  const maximumUnits=STRUCTURED_RESERVATION*(draft?1:2),used=await db.prepare("SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END),0) AS units FROM processing_budget").first<{units:number}>();
  let canRetry=true,reason=draft?'Reuse the saved draft and retry only its support check.':'Retry drafting and its support check for this thread.';
  if(!['failed','configuration','budget_blocked','reconciliation_exhausted'].includes(job.state)||job.run_state!=='partial'){canRetry=false;reason=job.state==='withheld'?'The support check rejected this advice. Review its evidence before requesting new coaching.':'Wait for current work or receipt reconciliation to finish.';}
  else if(reserved||job.state==='unknown'){canRetry=false;reason='A provider outcome or charge is unresolved. Its reservation remains held.';}
  else if(draftReceipt&&verifyReceipt&&job.state!=='reconciliation_exhausted'){canRetry=false;reason='Publish the saved draft and verification before requesting another paid attempt.';}
  else if(job.attempt>=2){canRetry=false;reason='This thread reached its three-attempt limit.';}
  else if(!env.OPENAI_API_KEY){canRetry=false;reason='Configure provider access before retrying coaching.';}
  else if((used?.units??0)+maximumUnits>50000000){canRetry=false;reason='The remaining allowance cannot cover this retry.';}
  return {job,draft,maximumUnits,canRetry,reason};
 }
 async function plan(owner:string,review:string,id:string){const p=await inspect(owner,review,id);return p?{jobId:id,attempt:p.job.attempt,canRetry:p.canRetry,reason:p.reason,maximumUnits:p.maximumUnits,reuseDraft:!!p.draft}:null;}
 async function retry(owner:string,review:string,input:unknown){
  const value=z.object({actionId:z.uuid(),jobId:z.string().min(1).max(100),attempt:z.number().int().min(0).max(2)}).strict().parse(input);
  if(!await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first())throw new RecoveryError(404,'Review not found.');
  const applied=()=>db.prepare("SELECT id FROM recovery_requests WHERE id=? AND stage='coaching' AND owner_id=? AND review_id=? AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.jobId,value.attempt).first();
  const old=await db.prepare('SELECT * FROM recovery_requests WHERE id=?').bind(value.actionId).first<{stage:string;owner_id:string;review_id:string;target_id:string;target_attempt:number;state:string}>();
  if(old){if(old.stage!=='coaching'||old.owner_id!==owner||old.review_id!==review||old.target_id!==value.jobId||old.target_attempt!==value.attempt)throw new RecoveryError(409,'This retry action belongs to different work.');if(old.state==='applied'){await reconcile();return {accepted:true};}}
  const owned=await db.prepare(current).bind(value.jobId,owner,review).first<Job>();if(!owned)throw new RecoveryError(409,'Coaching sources changed. Reanalyze the current review.');
  await createCoachingModule(env).recoverReceipts(value.jobId);
  const p=await inspect(owner,review,value.jobId);if((!p||p.job.attempt!==value.attempt||!p.canRetry)&&await applied()){await reconcile();return {accepted:true};}if(!p||p.job.attempt!==value.attempt)throw new RecoveryError(409,'The coaching retry plan changed. Reload before retrying.');if(!p.canRetry)throw new RecoveryError(409,p.reason);
  const eligible=`${current} AND j.attempt=? AND j.attempt<2 AND j.state IN ('failed','configuration','budget_blocked','reconciliation_exhausted') AND c.state='partial'
   AND NOT EXISTS(SELECT 1 FROM processing_budget WHERE id IN (j.id||CASE WHEN j.draft_attempt=0 THEN '' ELSE '-attempt-'||j.draft_attempt END||'-draft',j.id||CASE WHEN j.attempt=0 THEN '' ELSE '-attempt-'||j.attempt END||'-verify') AND state='reserved')
   AND NOT EXISTS(SELECT 1 FROM processing_jobs WHERE owner_id=c.owner_id AND (state='running' OR dispatch_state='cancel_pending'))
   AND NOT EXISTS(SELECT 1 FROM transcriptions WHERE owner_id=c.owner_id AND state IN ('queued','encoding','submitting','publishing'))
   AND NOT EXISTS(SELECT 1 FROM speaker_confirmations WHERE owner_id=c.owner_id AND state IN ('queued','running'))
   AND NOT EXISTS(SELECT 1 FROM grouping_runs WHERE owner_id=c.owner_id AND state='running')
   AND NOT EXISTS(SELECT 1 FROM coaching_runs WHERE owner_id=c.owner_id AND state IN ('queued','running'))`;
  const args=[value.jobId,owner,review,value.attempt];
  const statements=[db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,target_attempt,input_revision,context_revision,created_at,plan) SELECT ?,?,?,'coaching',?,?,r.input_revision,r.coaching_revision,?,? FROM reviews r WHERE r.id=? AND EXISTS(${eligible})`).bind(value.actionId,review,owner,value.jobId,value.attempt,Date.now(),JSON.stringify({reuseDraft:!!p.draft}),review,...args),
   db.prepare(`UPDATE coaching_jobs SET attempt=attempt+1,draft_attempt=?,reuse_draft=?,recovery_action_id=?,state='queued',draft=NULL,error=NULL,started_at=NULL,draft_dispatched=0,verify_dispatched=0,publication_attempts=0,publication_deadline=0,publication_checked_at=0 WHERE id=? AND EXISTS(${eligible}) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND stage='coaching' AND target_id=? AND target_attempt=? AND state='pending') AND COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+?<=50000000`).bind(p.draft?p.job.draft_attempt:value.attempt+1,p.draft,value.actionId,value.jobId,...args,value.actionId,value.jobId,value.attempt,p.maximumUnits)];
  for(const stage of (p.draft?['verify']:['draft','verify']) as ('draft'|'verify')[])statements.push(db.prepare("INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units) SELECT ?,'openai-coaching-v1',? WHERE EXISTS(SELECT 1 FROM coaching_jobs WHERE id=? AND recovery_action_id=? AND state='queued') AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND state='pending')").bind(coachingAttemptId(value.jobId,value.attempt+1,stage),STRUCTURED_RESERVATION,value.jobId,value.actionId,value.actionId));
  statements.push(db.prepare("UPDATE coaching_runs SET state='running',deadline=? WHERE id=? AND EXISTS(SELECT 1 FROM coaching_jobs WHERE id=? AND recovery_action_id=? AND state='queued') AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND state='pending')").bind(Date.now()+15*60000,p.job.run_id,value.jobId,value.actionId,value.actionId));
  statements.push(db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND EXISTS(SELECT 1 FROM coaching_jobs WHERE id=? AND recovery_action_id=? AND attempt=?)").bind(value.actionId,value.jobId,value.actionId,value.attempt+1));
  await db.batch(statements);
  if(!await applied())throw new RecoveryError(409,'The plan changed, another job is active, or the allowance is insufficient.');
  await reconcile();return {accepted:true};
 }
 async function work(actionId:string){
  const row=await db.prepare("SELECT j.id,j.run_id,j.attempt FROM recovery_requests q JOIN coaching_jobs j ON j.recovery_action_id=q.id JOIN coaching_runs c ON c.id=j.run_id JOIN reviews r ON r.id=c.review_id JOIN grouping_runs g ON g.id=c.grouping_id WHERE q.id=? AND q.stage='coaching' AND q.state='applied' AND c.state='running' AND c.deadline>? AND r.lifecycle='active' AND r.input_revision=c.revision AND r.coaching_revision=c.context_revision AND g.output_version=c.grouping_version").bind(actionId,Date.now()).first<{id:string;run_id:string;attempt:number}>();return row?{jobId:row.id,runId:row.run_id,attempt:row.attempt}:null;
 }
 async function reconcile(){
  await createCoachingModule(env).cleanup();if(!dispatch)return;
  const rows=(await db.prepare("SELECT q.id,c.grouping_id FROM recovery_requests q JOIN coaching_jobs j ON j.recovery_action_id=q.id JOIN coaching_runs c ON c.id=j.run_id WHERE q.stage='coaching' AND q.state='applied' AND q.dispatch_state<>'sent' AND q.dispatch_attempts<3 AND (q.dispatch_state='pending' OR q.dispatch_started_at<?) AND j.state='queued' AND c.state='running' AND c.deadline>? ORDER BY q.created_at LIMIT 10").bind(Date.now()-60000,Date.now()).all<{id:string;grouping_id:string}>()).results;
  for(const row of rows){if(!await work(row.id))continue;const claim=await db.prepare("UPDATE recovery_requests SET dispatch_state='sending',dispatch_started_at=?,dispatch_attempts=dispatch_attempts+1 WHERE id=? AND dispatch_state<>'sent' AND dispatch_attempts<3 AND (dispatch_state='pending' OR dispatch_started_at<?)").bind(Date.now(),row.id,Date.now()-60000).run();if(!claim.meta.changes)continue;try{await dispatch(row.id,row.grouping_id);await db.prepare("UPDATE recovery_requests SET dispatch_state='sent' WHERE id=?").bind(row.id).run();}catch{/* Retry only the same persisted Workflow identity. */}}
 }
 return {plan,retry,work,reconcile};
}
export function createRuntimeCoachingRetry(env:Environment & {CONTINUATION?:Workflow<{confirmationId:string;coachingRecoveryId?:string}>}) {
 return createCoachingRetry(env,env.CONTINUATION?async(actionId,groupingId)=>{await env.CONTINUATION!.createBatch([{id:'coaching-recovery-'+actionId,params:{confirmationId:groupingId,coachingRecoveryId:actionId}}]);}:undefined);
}
