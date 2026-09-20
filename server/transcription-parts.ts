import {z} from 'zod';
import {assembleTranscriptionParts} from '../lib/transcription-assembly';
import {decodeTranscriptionParts} from '../lib/transcription-parts';
import {parseTranscript} from '../lib/transcript';
import {transcriptionAttemptId,TRANSCRIPTION_RESERVATION} from '../lib/transcription-attempt';
import {createTranscriptionPartStore,type TranscriptionPart} from './transcription-part-store';
import {transcriptionReceiptCharge} from './transcription-receipt';
import {createBudgetLedger} from './budget';
import {mediaServiceRequest} from './media-service';
import type {PreparationResult} from './processing';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'AUTH_SECRET'|'OPENAI_API_KEY'|'LOCAL_MEDIA_ADAPTER'|'MEDIA_PROCESSOR'>;
type Parent={id:string;review_id:string;job_id:string;paid_attempt:number};
const live="EXISTS(SELECT 1 FROM reviews r WHERE r.id=transcriptions.review_id AND r.owner_id=transcriptions.owner_id AND r.lifecycle='active' AND r.input_revision=transcriptions.revision)";
const receiptSchema=z.object({response:z.string().max(8000000),requestId:z.string().nullable().optional()});
export function createMultipartTranscription(env:Environment,request:typeof fetch=fetch){
 const db=env.DB,store=createTranscriptionPartStore(db),budget=createBudgetLedger(db);
 async function current(row:Parent){return db.prepare(`SELECT state FROM transcriptions WHERE id=? AND paid_attempt=? AND state<>'cancelled' AND ${live}`).bind(row.id,row.paid_attempt).first<{state:string}>();}
 async function transition(row:Parent,state:string,error:string|null){
  await db.prepare(`UPDATE transcriptions SET state=?,error=? WHERE id=? AND paid_attempt=? AND state='encoding' AND ${live}`).bind(state,error,row.id,row.paid_attempt).run();
 }
 async function settleStopped(row:Parent){
  const parent=await current(row);
  if(parent&&!['failed','configuration','budget_blocked','cancelled'].includes(parent.state))return;
  const charge=await store.attemptCharge(row.id,row.paid_attempt);
  const call=transcriptionAttemptId(row.id,row.paid_attempt);
  if(charge!==null&&await db.prepare('SELECT id FROM processing_budget WHERE id=?').bind(call).first())await budget.settle(call,charge);
 }
 async function consume(row:Parent,part:TranscriptionPart,saved:unknown){
  const receipt=receiptSchema.parse(saved),charge=transcriptionReceiptCharge(receipt,part.provider_identity!);
  // Usage is retained independently of publication, including after deletion.
  await store.outcome(row.id,part.part_index,part.paid_attempt,{state:'unknown',chargeUnits:charge,requestId:receipt.requestId});
  if(charge===null)throw new Error('Part billing is unknown.');
  const data=JSON.parse(receipt.response);
  parseTranscript(data,`${row.id}:part-${part.part_index}`,part.source_sha256,part.duration_ms);
  await store.outcome(row.id,part.part_index,part.paid_attempt,{state:'ready',chargeUnits:charge,requestId:receipt.requestId});
  return data;
 }
 async function aggregate(row:Parent,audio:PreparationResult){
  const parts=await store.list(row.id);if(!parts.length||parts.some(part=>part.state!=='ready'))return null;
  const responses=[];
  for(const part of parts){
   const object=part.receipt_key?await env.MEDIA.get(part.receipt_key):null;if(!object)throw new Error('Saved transcription part is unavailable.');
   const receipt=receiptSchema.parse(await object.json());
   responses.push({index:part.part_index,offsetMs:part.offset_ms,durationMs:part.duration_ms,response:JSON.parse(receipt.response)});
  }
  const chargeUnits=await store.attemptCharge(row.id,row.paid_attempt);if(chargeUnits===null)throw new Error('Part billing is unknown.');
  const saved={kind:'transcription-parts-v1',callId:transcriptionAttemptId(row.id,row.paid_attempt),chargeUnits,transcript:assembleTranscriptionParts(row.id,audio.sha256,audio.durationMs,responses)};
  const key=`transcripts/${row.review_id}/${saved.callId}.provider.json`;
  if(!await current(row))return null;
  await env.MEDIA.put(key,JSON.stringify(saved),{httpMetadata:{contentType:'application/json'}});
  if(!await current(row)){await env.MEDIA.delete(key);return null;}
  return saved;
 }
 async function recover(row:Parent,audio:PreparationResult){
  const parts=await store.list(row.id);
  if(!parts.length)return null;
  for(const part of parts){
   if(!['submitting','unknown'].includes(part.state))continue;
   const receipt=part.receipt_key?await env.MEDIA.get(part.receipt_key):null;
   if(!receipt)throw new Error('A transcription part outcome is still unresolved.');
   await consume(row,part,await receipt.json());
  }
  const refreshed=await store.list(row.id);
  if(refreshed.some(part=>!['ready','queued'].includes(part.state)))throw new Error('A transcription part cannot resume.');
  return aggregate(row,audio);
 }
 async function run(row:Parent,audio:PreparationResult){
  let claimed:TranscriptionPart|null=null,savedReceipt=false;
  try{
   let parts=await store.list(row.id);
   if(!parts.length){
    const source=await env.MEDIA.get(audio.audioKey??audio.sourceKey);if(!source)throw new Error('Prepared audio is unavailable.');
    const response=await mediaServiceRequest(env,`/compression/${transcriptionAttemptId(row.id,row.paid_attempt)}`,{method:'POST',headers:{'x-transcription-parts':'1'},body:source.body,signal:AbortSignal.timeout(80000)},request);
    if(!response.ok||response.headers.get('content-type')!=='application/vnd.interview-coach.transcription-parts')throw new Error('Part compression failed.');
    const decoded=decodeTranscriptionParts(await response.arrayBuffer(),audio.durationMs);
    const upload=await db.prepare('SELECT upload_id FROM processing_jobs WHERE id=?').bind(row.job_id).first<{upload_id:string}>();if(!upload)throw new Error('Recording identity is unavailable.');
    const prepared=[];
    for(const part of decoded){
     const audioKey=`audio/${upload.upload_id}/${row.id}/part-${part.index}.mp3`;
     if(!await current(row))return null;
     await env.MEDIA.put(audioKey,part.audio);
     if(!await current(row)){await env.MEDIA.delete(audioKey);return null;}
     prepared.push({...part,audioKey});
    }
    parts=await store.initialize(row.id,row.paid_attempt,audio.sha256,prepared);
   }else{
    if(parts.reduce((sum,part)=>sum+part.duration_ms,0)!==audio.durationMs)throw new Error('Prepared duration changed.');
    parts=await store.initialize(row.id,row.paid_attempt,audio.sha256,parts.map(part=>({index:part.part_index,offsetMs:part.offset_ms,durationMs:part.duration_ms,audioKey:part.audio_key})));
   }
   const call=transcriptionAttemptId(row.id,row.paid_attempt);
   const reservation=await db.prepare('SELECT reserved_units FROM processing_budget WHERE id=?').bind(call).first<{reserved_units:number}>();
   if(!await budget.reserve(call,'openai-diarization-v1',reservation?.reserved_units??TRANSCRIPTION_RESERVATION)){
    await transition(row,'budget_blocked','The processing allowance cannot cover this transcription.');return null;
   }
   if(parts.some(part=>['submitting','unknown'].includes(part.state))){await transition(row,'unknown','A transcription part has an unresolved outcome. No new provider request was sent.');return null;}
   const pending=parts.find(part=>part.state==='queued');
   if(pending){
    const object=await env.MEDIA.get(pending.audio_key);if(!object)throw new Error('Compressed audio part is unavailable.');
    const bytes=await object.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>15000000)throw new Error('Compressed audio part is invalid.');
    claimed=await store.claim(row.id,pending.part_index,row.paid_attempt,row.review_id);if(!claimed)return null;
    const form=new FormData();form.set('file',new Blob([bytes],{type:'audio/mpeg'}),'interview.mp3');form.set('model','gpt-4o-transcribe-diarize');form.set('response_format','diarized_json');form.set('chunking_strategy','auto');form.set('language','en');
    const response=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'X-Client-Request-Id':claimed.provider_identity!},body:form,signal:AbortSignal.timeout(15*60000)});
    if(!response.ok){
     if([400,401,403,413,429].includes(response.status)){
      await store.outcome(row.id,claimed.part_index,row.paid_attempt,{state:'failed',chargeUnits:0,requestId:response.headers.get('x-request-id')});
      await transition(row,'failed',`The transcription provider rejected a recording part (HTTP ${response.status}). Completed parts are retained.`);
      return null;
     }
     throw new Error('Provider outcome is unresolved.');
    }
    const raw=await response.text();if(new TextEncoder().encode(raw).length>8000000)throw new Error('Provider response exceeds supported limits.');
    const receipt={response:raw,requestId:response.headers.get('x-request-id')};
    if(await current(row)){
     await env.MEDIA.put(claimed.receipt_key!,JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});savedReceipt=true;
     if(!await current(row))await env.MEDIA.delete(claimed.receipt_key!);
    }
    await consume(row,claimed,receipt);
   }
   const result=await aggregate(row,audio);
   if(!result)await transition(row,'queued',null);
   return result;
  }catch{
   if(claimed){
    // A previously recorded known charge must not be erased by a parsing failure.
    const part=(await store.list(row.id)).find(part=>part.part_index===claimed!.part_index);
    if(part?.state==='submitting')await store.outcome(row.id,part.part_index,part.paid_attempt,{state:'unknown',chargeUnits:null});
   }
   const unresolved=(await store.list(row.id)).some(part=>['submitting','unknown'].includes(part.state));
   await transition(row,savedReceipt?'reconciliation':unresolved?'unknown':'failed',savedReceipt?'A saved transcription part needs reconciliation. No paid request will be repeated.':unresolved?'A transcription part has an unresolved outcome. No paid request will be repeated.':'Transcription could not continue. Completed parts are retained.');
   return null;
  }finally{await settleStopped(row);}
 }
 return {run,consume,aggregate,recover,settleStopped};
}

export async function hasSavedTranscriptionParts(env:Pick<CloudflareEnv,'DB'|'MEDIA'>,id:string){
 const parts=await createTranscriptionPartStore(env.DB).list(id);
 if(parts.some(part=>part.state==='ready')&&parts.every(part=>['ready','queued'].includes(part.state)))return true;
 for(const part of parts){
  if(['submitting','unknown'].includes(part.state)&&part.receipt_key&&await env.MEDIA.head(part.receipt_key))return true;
 }
 return false;
}
