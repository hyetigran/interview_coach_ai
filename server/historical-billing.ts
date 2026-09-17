import {z} from 'zod';
import {createBudgetLedger} from './budget';
import {structuredCharge} from './openai-structured';
const attempts=(id:string)=>[0,1,2].map(attempt=>`${id}||'${attempt?`-attempt-${attempt}`:''}'`).join(',');
const coachingCalls=[0,1,2].flatMap(attempt=>['draft','verify'].map(stage=>`billing_job.id||'${attempt?`-attempt-${attempt}`:''}-${stage}'`)).join(',');
const operations=`SELECT billing.id,billing.reconciliation_checked_at,billing_run.owner_id,billing_run.review_id,'coaching' AS kind FROM processing_budget billing JOIN coaching_jobs billing_job ON billing.id IN (${coachingCalls}) JOIN coaching_runs billing_run ON billing_run.id=billing_job.run_id WHERE billing.state='reserved'
 UNION ALL SELECT billing.id,billing.reconciliation_checked_at,billing_transcript.owner_id,billing_transcript.review_id,'transcripts' AS kind FROM processing_budget billing JOIN transcriptions billing_transcript ON billing.id IN (${attempts('billing_transcript.id')}) WHERE billing.state='reserved'
 UNION ALL SELECT billing.id,billing.reconciliation_checked_at,billing_group.owner_id,billing_group.review_id,'grouping' AS kind FROM processing_budget billing JOIN grouping_chunks billing_chunk ON billing.id IN (${attempts('billing_chunk.id')}) JOIN grouping_runs billing_group ON billing_group.id=billing_chunk.run_id WHERE billing.state='reserved'
 UNION ALL SELECT billing.id,billing.reconciliation_checked_at,media_job.owner_id,media_job.review_id,'media' AS kind FROM processing_budget billing JOIN processing_jobs media_job ON billing.id IN ('media-operations-'||media_job.id,'media-operations-'||media_job.id||'-prepare-attempt-1','media-operations-'||media_job.id||'-prepare-attempt-2') WHERE billing.state='reserved'
 UNION ALL SELECT billing.id,billing.reconciliation_checked_at,media_transcript.owner_id,media_transcript.review_id,'media' AS kind FROM processing_budget billing JOIN transcriptions media_transcript ON billing.id IN ('media-compression-'||media_transcript.id,'media-compression-'||media_transcript.id||'-attempt-1','media-compression-'||media_transcript.id||'-attempt-2') WHERE billing.state='reserved'`;
// SQL expressions are supplied only by server code, never request input.
export function noUnresolvedProviders(ownerExpression:string,exceptReview?:string,reservedOperation?:string) {
 return `NOT EXISTS(SELECT 1 FROM (${operations}) billing_operation WHERE billing_operation.owner_id=${ownerExpression}${exceptReview?` AND billing_operation.review_id<>${exceptReview}`:''}${reservedOperation?` AND billing_operation.id<>${reservedOperation}`:''})`;
}
export async function reconcileProviderBilling(env:Pick<CloudflareEnv,'DB'|'MEDIA'>) {
 const db=env.DB,ledger=createBudgetLedger(db);
 const rows=(await db.prepare(`SELECT * FROM (${operations}) ORDER BY reconciliation_checked_at,id LIMIT 25`).all<{id:string;review_id:string;kind:string}>()).results;
 for(const row of rows){
  await db.prepare('UPDATE processing_budget SET reconciliation_checked_at=? WHERE id=?').bind(Date.now(),row.id).run();
  if(row.kind==='media')continue; // Cloudflare invoice reconciliation is operator-controlled.
  try {
   const object=await env.MEDIA.get(`${row.kind}/${row.review_id}/${row.id}.provider.json`);if(!object)continue;
   const receipt=z.object({response:z.string().max(8000000)}).parse(await object.json());
   const data=JSON.parse(receipt.response);
   const usage=row.kind==='transcripts'?z.object({usage:z.object({type:z.literal('tokens'),input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()})}).parse(data).usage:null;
   await ledger.settle(row.id,usage?Math.ceil(usage.input_tokens*2.5+usage.output_tokens*10):structuredCharge(data));
  }catch{/* Missing or invalid billing evidence keeps its original reservation. */}
 }
}
