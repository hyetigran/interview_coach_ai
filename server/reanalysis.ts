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
  await db.prepare("INSERT OR IGNORE INTO coaching_runs(id,review_id,owner_id,revision,context_revision,grouping_id,state,dispatch_state,deadline,model,prompt_version,rubric_version,schema_version,verification_version) SELECT ?,reviews.id,reviews.owner_id,reviews.input_revision,reviews.coaching_revision,grouping_runs.id,'queued','pending',0,?,?,?,?,? FROM reviews JOIN grouping_runs ON grouping_runs.review_id=reviews.id JOIN speaker_confirmations ON speaker_confirmations.id=grouping_runs.id WHERE reviews.id=? AND reviews.owner_id=? AND reviews.lifecycle='active' AND reviews.coaching_revision=? AND grouping_runs.revision=reviews.input_revision AND grouping_runs.state IN ('ready','partial') AND speaker_confirmations.state='confirmed'").bind(value.actionId,v.model,v.prompt,v.rubric,v.schema,v.verification,review,owner,value.contextRevision).run();
  const row=await db.prepare("SELECT coaching_runs.id,coaching_runs.state FROM coaching_runs JOIN reviews ON reviews.id=coaching_runs.review_id WHERE reviews.id=? AND reviews.owner_id=? AND reviews.lifecycle='active' AND reviews.coaching_revision=? AND coaching_runs.context_revision=reviews.coaching_revision AND coaching_runs.revision=reviews.input_revision").bind(review,owner,value.contextRevision).first<{id:string;state:string}>();
  if(!row)throw new ContextError(409,'Wait for question grouping to finish, or reload changed context before reanalysis.');
  await reconcile();return row;
 }
 async function reconcile() {
  await createCoachingModule(env).cleanup();if(!send)return;
  const rows=(await db.prepare("SELECT id,grouping_id FROM coaching_runs WHERE state='queued' OR (state='running' AND dispatch_state='pending') ORDER BY rowid LIMIT 25").all<{id:string;grouping_id:string}>()).results;
  for(const row of rows){
   await db.prepare("UPDATE coaching_runs SET state='running',deadline=? WHERE id=? AND state='queued' AND EXISTS(SELECT 1 FROM reviews WHERE reviews.id=coaching_runs.review_id AND reviews.lifecycle='active' AND reviews.coaching_revision=coaching_runs.context_revision AND reviews.input_revision=coaching_runs.revision) AND NOT EXISTS(SELECT 1 FROM processing_jobs WHERE owner_id=coaching_runs.owner_id AND state='running') AND NOT EXISTS(SELECT 1 FROM transcriptions WHERE owner_id=coaching_runs.owner_id AND state IN ('queued','encoding','submitting')) AND NOT EXISTS(SELECT 1 FROM grouping_runs WHERE owner_id=coaching_runs.owner_id AND state='running') AND NOT EXISTS(SELECT 1 FROM speaker_confirmations WHERE owner_id=coaching_runs.owner_id AND state='running') AND NOT EXISTS(SELECT 1 FROM coaching_runs AS other WHERE other.owner_id=coaching_runs.owner_id AND other.state='running')").bind(Date.now()+3*3600000,row.id).run();
   if(!await db.prepare("SELECT id FROM coaching_runs WHERE id=? AND state='running' AND dispatch_state='pending'").bind(row.id).first())continue;
   try {await send(row.id,row.grouping_id);await db.prepare("UPDATE coaching_runs SET dispatch_state='sent' WHERE id=? AND state='running'").bind(row.id).run();}catch{/* Re-deliver the same persisted Workflow identity. */}
  }
 }
 return {request,reconcile};
}
