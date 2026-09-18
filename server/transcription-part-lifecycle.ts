import {z} from 'zod';
import {transcriptionAttemptId} from '../lib/transcription-attempt';
import {createBudgetLedger} from './budget';
import {createTranscriptionPartStore} from './transcription-part-store';
import {transcriptionReceiptCharge} from './transcription-receipt';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'>;
/** Read failures stop deletion; invalid billing evidence keeps its reservation. */
async function savedCharge(env:Environment,key:string,call:string,part=false){
 const object=await env.MEDIA.get(key);if(!object)return null;
 const raw=await object.text();
 try{
  const saved=JSON.parse(raw);
  return transcriptionReceiptCharge(part?z.object({response:z.string().max(8000000)}).parse(saved):saved,call);
 }catch{return null;}
}
export async function reconcileTranscriptionPartBilling(env:Environment,id:string){
 const db=env.DB,store=createTranscriptionPartStore(db),budget=createBudgetLedger(db);
 const parts=await store.list(id);if(!parts.length)return;
 for(const part of parts){
  if(part.submitted_at===null||part.charge_units!==null||!part.receipt_key||!part.provider_identity)continue;
  const charge=await savedCharge(env,part.receipt_key,part.provider_identity,true);
  if(charge===null||charge>2000000)continue;
  await store.outcome(id,part.part_index,part.paid_attempt,{state:'unknown',chargeUnits:charge});
 }
 // Active partial work still needs its reservation for the remaining parts.
 const stopped=await db.prepare("SELECT t.id FROM transcriptions t WHERE t.id=? AND (t.state IN ('failed','configuration','budget_blocked','cancelled','ready') OR NOT EXISTS(SELECT 1 FROM reviews r WHERE r.id=t.review_id AND r.owner_id=t.owner_id AND r.lifecycle='active' AND r.input_revision=t.revision))").bind(id).first();
 if(!stopped)return;
 for(const attempt of new Set(parts.map(part=>part.paid_attempt))){
  const call=transcriptionAttemptId(id,attempt);
  const ledger=await db.prepare("SELECT id FROM processing_budget WHERE id=? AND state='reserved'").bind(call).first();
  const charge=await store.attemptCharge(id,attempt);
  if(ledger&&charge!==null)await budget.settle(call,charge);
 }
}
export async function cleanupTranscriptionArtifacts(env:Environment,id:string){
 const row=await env.DB.prepare("SELECT t.review_id FROM transcriptions t WHERE t.id=? AND (t.state='cancelled' OR NOT EXISTS(SELECT 1 FROM reviews r WHERE r.id=t.review_id AND r.owner_id=t.owner_id AND r.lifecycle='active'))").bind(id).first<{review_id:string}>();
 if(!row)return;
 await reconcileTranscriptionPartBilling(env,id);
 const budget=createBudgetLedger(env.DB),keys:string[]=[];
 for(const attempt of [0,1,2]){
  const call=transcriptionAttemptId(id,attempt),receipt=`transcripts/${row.review_id}/${call}.provider.json`;
  const ledger=await env.DB.prepare("SELECT reserved_units FROM processing_budget WHERE id=? AND state='reserved'").bind(call).first<{reserved_units:number}>();
  if(ledger){
   const charge=await savedCharge(env,receipt,call);
   // A policy overage keeps the reservation unresolved, but cannot prevent
   // removal of interview content after deletion was requested.
   if(charge!==null&&charge<=ledger.reserved_units)await budget.settle(call,charge);
  }
  keys.push(`transcripts/${row.review_id}/${call}.json`,receipt,...[0,1,2].map(index=>`transcripts/${row.review_id}/${call}-part-${index}.provider.json`));
 }
 const parts=await createTranscriptionPartStore(env.DB).list(id);
 await env.DB.prepare("UPDATE transcription_parts SET state='cancelled' WHERE transcription_id=?").bind(id).run();
 await env.MEDIA.delete([...keys,...parts.map(part=>part.audio_key)]);
}
