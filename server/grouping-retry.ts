import {accountSlotAvailable} from './account-slot';
import {z} from 'zod';
import {RecoveryError} from './recovery';
import {createGroupingModule,GROUPING_RESERVATION} from './grouping';
import {groupingAttemptId} from '../lib/grouping-attempt';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'OPENAI_API_KEY'>;
type Run={id:string;transcript_id:string;revision:number;output_version:number;total:number;state:string};
type Chunk={publication_retries:number;id:string;ordinal:number;attempt:number;state:string;result:string|null;input_payload:string|null;billing:string|null};
const stepsSchema=z.array(z.object({ordinal:z.number().int().nonnegative(),attempt:z.number().int().min(1).max(2)})).max(1000);
type Dispatch=(actionId:string,runId:string)=>Promise<void>;
export function createGroupingRetry(env:Environment,dispatch?:Dispatch) {
 const db=env.DB;
 async function inspect(owner:string,review:string) {
  const run=await db.prepare("SELECT g.* FROM grouping_runs g JOIN reviews r ON r.id=g.review_id JOIN speaker_confirmations s ON s.id=g.id WHERE g.owner_id=? AND g.review_id=? AND r.lifecycle='active' AND r.input_revision=g.revision AND s.state='confirmed'").bind(owner,review).first<Run>();
  if(!run)throw new RecoveryError(409,'Confirm your voice and wait for grouping to finish.');
  const rows=(await db.prepare("SELECT c.*,b.state AS billing FROM grouping_chunks c LEFT JOIN processing_budget b ON b.id=CASE WHEN c.attempt=0 THEN c.id ELSE c.id||'-attempt-'||c.attempt END WHERE c.run_id=? ORDER BY c.ordinal").bind(run.id).all<Chunk>()).results;
  const start=rows.findIndex(row=>row.state!=='ready');
  const suffix=start<0?[]:rows.slice(start);
  let reason='Retry the incomplete section and recheck dependent sections. Unchanged completed results will be reused.';
  const manual=await db.prepare('SELECT id FROM transcript_correction_intents WHERE id=? AND manual_groups IS NOT NULL').bind(run.transcript_id).first();
  for(const row of suffix){
   if(row.state==='ready'||!await env.MEDIA.head(`grouping/${review}/${groupingAttemptId(row.id,row.attempt)}.provider.json`))continue;
   const publication={chunkId:row.id,attempt:row.attempt,cycle:row.publication_retries};
   return {run,rows,suffix:[row],publication,publicationPending:['reconciliation','publishing','unknown','failed'].includes(row.state),maximumUnits:0,canRetry:!manual&&run.state==='partial'&&row.state==='reconciliation_exhausted'&&row.publication_retries<2,reason:manual?'Your saved question groups are authoritative. Use Correct question groups.':row.publication_retries>=2?'Saved grouping publication reached its three-window limit. Its receipt remains retained.':'Publish the saved grouping result without another provider request.'};
  }
  const used=await db.prepare("SELECT COALESCE(SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END),0) AS units FROM processing_budget").first<{units:number}>();
  let canRetry=true;
  if(!suffix.length){canRetry=false;reason='All grouping sections are complete.';}
  else if(manual){canRetry=false;reason='Your saved question groups are authoritative. Use Correct question groups to review the incomplete sections.';}
  else if(run.state!=='partial'||rows.length!==run.total||suffix.some(row=>!['ready','failed','configuration','budget_blocked','reconciliation_exhausted'].includes(row.state))){canRetry=false;reason='Wait for active work or saved provider results to finish reconciliation.';}
  else if(suffix.some(row=>row.billing==='reserved')){canRetry=false;reason='A provider charge is unresolved. Its reservation stays held until reconciliation.';}
  else if(suffix.some(row=>row.attempt>=2)){canRetry=false;reason='A dependent section reached its three-attempt limit.';}
  else if(!env.OPENAI_API_KEY){canRetry=false;reason='Configure provider access before retrying grouping.';}
  else if((used?.units??0)+suffix.length*GROUPING_RESERVATION>50000000){canRetry=false;reason='The remaining processing allowance cannot cover the dependent sections.';}
  for(const row of suffix){if(canRetry&&row.state==='failed'&&await env.MEDIA.head(`grouping/${review}/${groupingAttemptId(row.id,row.attempt)}.provider.json`)){canRetry=false;reason='Publish the saved provider result before requesting another paid attempt.';}}
  return {run,rows,suffix,canRetry,reason,maximumUnits:suffix.length*GROUPING_RESERVATION};
 }
 async function plan(owner:string,review:string) {
  try{const p=await inspect(owner,review);return {runId:p.run.id,version:p.run.output_version,publication:p.publication,publicationPending:p.publicationPending,canRetry:p.canRetry,reason:p.reason,maximumUnits:p.maximumUnits,sections:p.suffix.map(row=>row.ordinal+1)};}catch(error){if(error instanceof RecoveryError)return null;throw error;}
 }
 async function retry(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),runId:z.string().min(1).max(120),version:z.number().int().nonnegative(),publication:z.object({chunkId:z.string().min(1).max(200),attempt:z.number().int().min(0).max(2),cycle:z.number().int().min(0).max(2)}).strict().optional()}).strict().parse(input);
  if(!await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first())throw new RecoveryError(404,'Review not found.');
  const old=await db.prepare('SELECT * FROM recovery_requests WHERE id=?').bind(value.actionId).first<{stage:string;target_id:string;target_attempt:number;owner_id:string;review_id:string;state:string}>();
  if(old){if(old.stage!=='grouping'||old.target_id!==value.runId||old.target_attempt!==value.version||old.owner_id!==owner||old.review_id!==review)throw new RecoveryError(409,'This retry action belongs to different work.');if(old.state==='applied'){await reconcile();return {accepted:true};}}
  const grouping=createGroupingModule(env);
  const before=await inspect(owner,review);
  for(const row of before.suffix)await grouping.recoverReceipt(before.run.id,row.ordinal);
  const p=await inspect(owner,review);
  if(!p.canRetry){if(await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='grouping' AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.runId,value.version).first()){await reconcile();return {accepted:true};}throw new RecoveryError(409,p.reason);}
  if(p.run.id!==value.runId||p.run.output_version!==value.version)throw new RecoveryError(409,'Grouping changed. Reload the retry plan.');
  if(p.publication){
   if(!value.publication||JSON.stringify(value.publication)!==JSON.stringify(p.publication))throw new RecoveryError(409,'Reload the saved grouping publication plan.');
   const item=value.publication;
   const eligible=`SELECT c.id FROM grouping_chunks c JOIN grouping_runs g ON g.id=c.run_id JOIN reviews r ON r.id=g.review_id JOIN speaker_confirmations s ON s.id=g.id WHERE c.id=? AND c.attempt=? AND c.publication_retries=? AND c.publication_retries<2 AND c.state='reconciliation_exhausted' AND g.id=? AND g.owner_id=? AND g.review_id=? AND g.output_version=? AND g.state='partial' AND r.lifecycle='active' AND r.input_revision=g.revision AND s.state='confirmed' AND NOT EXISTS(SELECT 1 FROM transcript_correction_intents WHERE id=g.transcript_id AND manual_groups IS NOT NULL)`;
   const args=[item.chunkId,item.attempt,item.cycle,value.runId,owner,review,value.version];
   await db.batch([
    db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,target_attempt,input_revision,context_revision,created_at,plan) SELECT ?,?,?,'grouping',?,?,r.input_revision,r.coaching_revision,?,? FROM reviews r WHERE r.id=? AND EXISTS(${eligible})`).bind(value.actionId,review,owner,value.runId,value.version,Date.now(),JSON.stringify({publication:item}),review,...args),
    db.prepare(`UPDATE grouping_chunks SET state='reconciliation',publication_retries=publication_retries+1,publication_attempts=0,publication_deadline=0,publication_checked_at=0,recovery_action_id=?,error='Retrying saved grouping publication without another provider request.' WHERE id IN (${eligible}) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='grouping' AND target_id=? AND target_attempt=? AND state='pending')`).bind(value.actionId,...args,value.actionId,owner,review,value.runId,value.version),
    db.prepare("UPDATE recovery_requests SET state='applied',dispatch_state='sent' WHERE id=? AND owner_id=? AND review_id=? AND stage='grouping' AND EXISTS(SELECT 1 FROM grouping_chunks WHERE id=? AND recovery_action_id=?)").bind(value.actionId,owner,review,item.chunkId,value.actionId),
   ]);
   if(!await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='grouping' AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.runId,value.version).first())throw new RecoveryError(409,'The saved publication plan changed. Reload before retrying.');
   return {accepted:true};
  }
  if(value.publication)throw new RecoveryError(409,'Saved publication changed. Reload before planning any paid work.');
  for(const row of p.suffix){
   if(row.state!=='ready'||row.input_payload)continue;
   const object=await env.MEDIA.get(`grouping/${review}/${groupingAttemptId(row.id,row.attempt)}.provider.json`);
   if(!object)continue;
   const receipt=z.object({input:z.string().max(250000),transcriptId:z.string()}).safeParse(await object.json());
   if(receipt.success&&receipt.data.transcriptId===p.run.transcript_id)await db.prepare("UPDATE grouping_chunks SET input_payload=? WHERE id=? AND attempt=? AND state='ready' AND input_payload IS NULL").bind(receipt.data.input,row.id,row.attempt).run();
  }
  const start=p.suffix[0].ordinal,steps=p.suffix.map(row=>({ordinal:row.ordinal,attempt:row.attempt+1}));
  const eligible=`SELECT g.id FROM grouping_runs g JOIN reviews r ON r.id=g.review_id JOIN speaker_confirmations s ON s.id=g.id
   WHERE g.id=? AND g.owner_id=? AND g.review_id=? AND g.output_version=? AND g.state='partial'
   AND r.lifecycle='active' AND r.input_revision=g.revision AND s.state='confirmed'
   AND NOT EXISTS(SELECT 1 FROM transcript_correction_intents WHERE id=g.transcript_id AND manual_groups IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM grouping_chunks c LEFT JOIN processing_budget b ON b.id=CASE WHEN c.attempt=0 THEN c.id ELSE c.id||'-attempt-'||c.attempt END WHERE c.run_id=g.id AND c.ordinal>=? AND (c.attempt>=2 OR c.state NOT IN ('ready','failed','configuration','budget_blocked','reconciliation_exhausted') OR b.state='reserved'))
   AND ${accountSlotAvailable('g.owner_id')}`;
  const args=[value.runId,owner,review,value.version,start];
  const statements=[db.prepare(`INSERT OR IGNORE INTO recovery_requests(id,review_id,owner_id,stage,target_id,target_attempt,input_revision,context_revision,created_at,plan,state) SELECT ?,?,?,'grouping',?,?,?,(SELECT coaching_revision FROM reviews WHERE id=?),?,?,'pending' WHERE EXISTS(${eligible})`).bind(value.actionId,review,owner,value.runId,value.version,p.run.revision,review,Date.now(),JSON.stringify(steps),...args),
   db.prepare(`UPDATE grouping_runs SET recovery_action_id=?,state='running',deadline=?,output_version=output_version+1 WHERE id IN (${eligible}) AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND stage='grouping' AND state='pending' AND target_id=? AND target_attempt=?) AND COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+?<=50000000`).bind(value.actionId,Date.now()+3*3600000,...args,value.actionId,value.runId,value.version,p.maximumUnits)];
  statements.push(db.prepare("INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units) SELECT c.id||'-attempt-'||(c.attempt+1),'openai-grouping-v1',? FROM grouping_chunks c JOIN grouping_runs g ON g.id=c.run_id WHERE c.run_id=? AND c.ordinal>=? AND g.recovery_action_id=? AND g.state='running' AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND state='pending')").bind(GROUPING_RESERVATION,value.runId,start,value.actionId,value.actionId));
  statements.push(db.prepare("UPDATE grouping_chunks SET reuse_result=CASE WHEN state='ready' THEN result ELSE NULL END,reuse_input=CASE WHEN state='ready' THEN input_payload ELSE NULL END,state='queued',attempt=attempt+1,recovery_action_id=?,submitted=0,input_payload=NULL,error=NULL,started_at=NULL,publication_attempts=0,publication_deadline=0,publication_checked_at=0 WHERE run_id=? AND ordinal>=? AND EXISTS(SELECT 1 FROM grouping_runs WHERE id=? AND recovery_action_id=? AND state='running') AND EXISTS(SELECT 1 FROM recovery_requests WHERE id=? AND state='pending')").bind(value.actionId,value.runId,start,value.runId,value.actionId,value.actionId));
  statements.push(db.prepare("UPDATE recovery_requests SET state='applied' WHERE id=? AND EXISTS(SELECT 1 FROM grouping_runs WHERE id=? AND recovery_action_id=?)").bind(value.actionId,value.runId,value.actionId));
  await db.batch(statements);
  if(!await db.prepare("SELECT id FROM recovery_requests WHERE id=? AND owner_id=? AND review_id=? AND stage='grouping' AND target_id=? AND target_attempt=? AND state='applied'").bind(value.actionId,owner,review,value.runId,value.version).first())throw new RecoveryError(409,'The retry plan changed, another job is active, or the allowance is insufficient.');
  await reconcile();return {accepted:true};
 }
 async function work(actionId:string) {
  const row=await db.prepare("SELECT q.target_id,q.plan FROM recovery_requests q JOIN grouping_runs g ON g.recovery_action_id=q.id JOIN reviews r ON r.id=g.review_id WHERE q.id=? AND q.stage='grouping' AND q.state='applied' AND g.state='running' AND g.deadline>? AND r.lifecycle='active' AND r.input_revision=g.revision").bind(actionId,Date.now()).first<{target_id:string;plan:string}>();
  return row?{runId:row.target_id,steps:stepsSchema.parse(JSON.parse(row.plan))}:null;
 }
 async function reconcile() {
  await db.prepare("UPDATE grouping_chunks SET state='failed',error='Retry dispatch expired before this section started.' WHERE state='queued' AND EXISTS(SELECT 1 FROM recovery_requests q WHERE q.id=grouping_chunks.recovery_action_id AND q.stage='grouping' AND q.state='applied' AND q.dispatch_state<>'sent' AND q.created_at<?)").bind(Date.now()-15*60000).run();
  await db.prepare("UPDATE grouping_runs SET state='partial' WHERE state='running' AND EXISTS(SELECT 1 FROM recovery_requests q WHERE q.id=grouping_runs.recovery_action_id AND q.dispatch_state<>'sent' AND q.created_at<?) AND NOT EXISTS(SELECT 1 FROM grouping_chunks WHERE run_id=grouping_runs.id AND state IN ('queued','preparing','submitting','publishing'))").bind(Date.now()-15*60000).run();
  await createGroupingModule(env).cleanup();if(!dispatch)return;
  const rows=(await db.prepare("SELECT q.id,q.target_id FROM recovery_requests q JOIN grouping_runs g ON g.recovery_action_id=q.id JOIN reviews r ON r.id=g.review_id WHERE q.stage='grouping' AND q.state='applied' AND q.dispatch_state<>'sent' AND q.dispatch_attempts<3 AND (q.dispatch_state='pending' OR q.dispatch_started_at<?) AND g.state='running' AND g.deadline>? AND r.lifecycle='active' AND r.input_revision=g.revision ORDER BY q.created_at LIMIT 10").bind(Date.now()-60000,Date.now()).all<{id:string;target_id:string}>()).results;
  for(const row of rows){const claim=await db.prepare("UPDATE recovery_requests SET dispatch_state='sending',dispatch_started_at=?,dispatch_attempts=dispatch_attempts+1 WHERE id=? AND dispatch_state<>'sent' AND dispatch_attempts<3 AND (dispatch_state='pending' OR dispatch_started_at<?)").bind(Date.now(),row.id,Date.now()-60000).run();if(!claim.meta.changes)continue;try{await dispatch(row.id,row.target_id);await db.prepare("UPDATE recovery_requests SET dispatch_state='sent' WHERE id=?").bind(row.id).run();}catch{/* The same Workflow identity is retried after the dispatch lease. */}}
 }
 return {plan,retry,work,reconcile};
}
export function createRuntimeGroupingRetry(env:Environment & {CONTINUATION?:Workflow<{confirmationId:string;groupingRecoveryId?:string}>}) {
 return createGroupingRetry(env,env.CONTINUATION?async(actionId,runId)=>{await env.CONTINUATION!.createBatch([{id:'grouping-recovery-'+actionId,params:{confirmationId:runId,groupingRecoveryId:actionId}}]);}:undefined);
}
