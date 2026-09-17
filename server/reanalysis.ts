import {accountSlotAvailable} from './account-slot';
import {reconcileProviderBilling} from './historical-billing';
import {z} from 'zod';
import {ContextError} from './review-context';
import {COACHING_VERSIONS} from '../lib/coaching';
import {createCoachingModule} from './coaching';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'OPENAI_API_KEY'|'CONTINUATION'>;
export function createReanalysisModule(env:Environment,dispatch?:(id:string,groupingId:string)=>Promise<void>) {
 const db=env.DB;
 const send=dispatch??(env.CONTINUATION?async(id:string,groupingId:string)=>{await env.CONTINUATION!.createBatch([{id:'reanalyze-'+id,params:{confirmationId:groupingId,coachingRunId:id}}]);}:undefined);
 async function request(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),contextRevision:z.number().int().positive()}).strict().parse(input),v=COACHING_VERSIONS;
  if(!await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND coaching_revision=?").bind(review,owner,value.contextRevision).first())throw new ContextError(409,'The review or context changed. Reload before reanalysis.');
  const receipt=await db.prepare('SELECT * FROM recovery_requests WHERE id=?').bind(value.actionId).first<{owner_id:string;review_id:string;stage:string;context_revision:number;state:string}>();
  if(receipt){
   if(receipt.owner_id!==owner||receipt.review_id!==review||receipt.stage!=='reanalysis'||receipt.context_revision!==value.contextRevision)throw new ContextError(409,'This action belongs to different work.');
   if(receipt.state==='applied')return {id:value.actionId,state:'accepted'};
  }
  if(await db.prepare("SELECT id FROM recovery_requests WHERE target_id=? AND owner_id=? AND review_id=? AND stage='reanalysis' AND state='applied'").bind(value.actionId,owner,review).first())return {id:value.actionId,state:'accepted'};
  await createCoachingModule(env).cleanup();
  await db.prepare("INSERT OR IGNORE INTO coaching_runs(id,review_id,owner_id,revision,context_revision,grouping_id,grouping_version,state,dispatch_state,deadline,model,prompt_version,rubric_version,schema_version,verification_version) SELECT ?,reviews.id,reviews.owner_id,reviews.input_revision,reviews.coaching_revision,grouping_runs.id,grouping_runs.output_version,'queued','pending',0,?,?,?,?,? FROM reviews JOIN grouping_runs ON grouping_runs.review_id=reviews.id JOIN speaker_confirmations ON speaker_confirmations.id=grouping_runs.id WHERE reviews.id=? AND reviews.owner_id=? AND reviews.lifecycle='active' AND reviews.coaching_revision=? AND grouping_runs.revision=reviews.input_revision AND grouping_runs.state IN ('ready','partial') AND speaker_confirmations.state='confirmed'").bind(value.actionId,v.model,v.prompt,v.rubric,v.schema,v.verification,review,owner,value.contextRevision).run();
  const row=await db.prepare("SELECT coaching_runs.id,coaching_runs.state FROM coaching_runs JOIN reviews ON reviews.id=coaching_runs.review_id WHERE reviews.id=? AND reviews.owner_id=? AND reviews.lifecycle='active' AND reviews.coaching_revision=? AND coaching_runs.context_revision=reviews.coaching_revision AND coaching_runs.revision=reviews.input_revision AND coaching_runs.grouping_version=(SELECT output_version FROM grouping_runs WHERE id=coaching_runs.grouping_id)").bind(review,owner,value.contextRevision).first<{id:string;state:string}>();
  if(!row)throw new ContextError(409,'Wait for question grouping to finish, or reload changed context before reanalysis.');
  if(row.state==='partial'&&row.id!==value.actionId&&!await db.prepare('SELECT id FROM coaching_jobs WHERE run_id=? LIMIT 1').bind(row.id).first()) {
   const eligible=`SELECT c.id FROM coaching_runs c JOIN reviews r ON r.id=c.review_id WHERE c.id=? AND c.owner_id=? AND c.review_id=? AND c.state='partial' AND c.deadline<=? AND c.retry_attempts<3 AND r.lifecycle='active' AND r.input_revision=c.revision AND r.coaching_revision=c.context_revision AND r.coaching_revision=? AND c.grouping_version=(SELECT output_version FROM grouping_runs WHERE id=c.grouping_id) AND NOT EXISTS(SELECT 1 FROM coaching_jobs WHERE run_id=c.id)`;
   const args=[row.id,owner,review,Date.now(),value.contextRevision];
   await db.batch([
    db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,input_revision,context_revision,created_at) SELECT ?,?,?,'reanalysis',id,revision,context_revision,? FROM coaching_runs WHERE id IN (${eligible})`).bind(value.actionId,review,owner,Date.now(),...args),
    db.prepare(`UPDATE coaching_runs SET id=?,state='queued',deadline=0,dispatch_state='pending',dispatch_attempts=0,dispatch_started_at=0,retry_attempts=retry_attempts+1 WHERE id IN (${eligible}) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='reanalysis' AND target_id=? AND state='pending')`).bind(value.actionId,...args,value.actionId,owner,review,row.id),
    db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND owner_id=? AND review_id=? AND stage='reanalysis' AND EXISTS(SELECT 1 FROM coaching_runs WHERE id=? AND owner_id=? AND review_id=?)").bind(value.actionId,owner,review,value.actionId,owner,review),
   ]);
   if(!await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='reanalysis' AND state='applied'").bind(value.actionId,owner,review).first())throw new ContextError(409,'Reanalysis changed or reached its three-attempt limit. Reload before retrying.');
   await reconcile();return {id:value.actionId,state:'queued'};
  }
  await reconcile();return row;
 }
 async function reconcile() {
  await createCoachingModule(env).cleanup();await reconcileProviderBilling(env);if(!send)return;
  const rows=(await db.prepare("SELECT id,grouping_id FROM coaching_runs WHERE state='queued' OR (state='running' AND dispatch_state='pending') ORDER BY rowid LIMIT 25").all<{id:string;grouping_id:string}>()).results;
  for(const row of rows){
   await db.prepare(`UPDATE coaching_runs SET state='running',deadline=? WHERE id=? AND state='queued' AND EXISTS(SELECT 1 FROM reviews WHERE reviews.id=coaching_runs.review_id AND reviews.lifecycle='active' AND reviews.coaching_revision=coaching_runs.context_revision AND reviews.input_revision=coaching_runs.revision) AND ${accountSlotAvailable('coaching_runs.owner_id')}`).bind(Date.now()+3*3600000,row.id).run();
   const delivery=await db.prepare("UPDATE coaching_runs SET dispatch_attempts=dispatch_attempts+1,dispatch_started_at=? WHERE id=? AND state='running' AND dispatch_state='pending' AND dispatch_attempts<3 AND dispatch_started_at<? AND deadline>? AND EXISTS(SELECT 1 FROM reviews WHERE id=coaching_runs.review_id AND lifecycle='active' AND input_revision=coaching_runs.revision AND coaching_revision=coaching_runs.context_revision)").bind(Date.now(),row.id,Date.now()-60000,Date.now()).run();
   if(!delivery.meta.changes)continue;
   try {await send(row.id,row.grouping_id);await db.prepare("UPDATE coaching_runs SET dispatch_state='sent' WHERE id=? AND state='running'").bind(row.id).run();}catch{/* Re-deliver the same persisted Workflow identity. */}
  }
 }
 return {request,reconcile};
}
