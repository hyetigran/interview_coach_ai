import {z} from 'zod';
import {transcriptionAttemptId} from '../lib/transcription-attempt';
export type TranscriptionPart={transcription_id:string;part_index:number;offset_ms:number;duration_ms:number;source_sha256:string;audio_key:string;state:string;paid_attempt:number;provider_identity:string|null;receipt_key:string|null;request_id:string|null;submitted_at:number|null;charge_units:number|null};
type PreparedPart={index:number;offsetMs:number;durationMs:number;audioKey:string};
const active="EXISTS(SELECT 1 FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=transcription_parts.transcription_id AND t.state='encoding' AND t.paid_attempt=transcription_parts.paid_attempt AND r.lifecycle='active' AND r.input_revision=t.revision)";
export function createTranscriptionPartStore(db:D1Database){
 const list=async(id:string)=>(await db.prepare('SELECT * FROM transcription_parts WHERE transcription_id=? ORDER BY part_index').bind(id).all<TranscriptionPart>()).results;
 async function initialize(id:string,attempt:number,hash:string,parts:PreparedPart[]){
  z.string().regex(/^[a-f0-9]{64}$/).parse(hash);
  z.number().int().min(0).max(2).parse(attempt);
  if(!parts.length||parts.length>3)throw new Error('Invalid transcription part count.');
  let offset=0;
  for(const [index,part] of parts.entries()){
   if(part.index!==index||part.offsetMs!==offset||!Number.isSafeInteger(part.durationMs)||part.durationMs<=0||part.durationMs>1200000||!part.audioKey)throw new Error('Invalid transcription part timeline.');
   offset+=part.durationMs;
  }
  if(!await db.prepare("SELECT t.id FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=? AND t.paid_attempt=? AND t.state='encoding' AND r.lifecycle='active' AND r.input_revision=t.revision").bind(id,attempt).first())throw new Error('Transcription part preparation was revoked.');
  const previous=await list(id);
  if(previous.length&&(previous.length!==parts.length||previous.some((row,index)=>row.source_sha256!==hash||row.offset_ms!==parts[index].offsetMs||row.duration_ms!==parts[index].durationMs||row.audio_key!==parts[index].audioKey)))throw new Error('Transcription part identity changed.');
  // The manifest and all rows commit together. A competing initializer can only
  // insert rows belonging to the winning immutable identity.
  const identity=JSON.stringify({hash,parts:parts.map(({index,offsetMs,durationMs,audioKey})=>({index,offsetMs,durationMs,audioKey}))});
  await db.batch([
   db.prepare("INSERT OR IGNORE INTO transcription_part_manifests(transcription_id,identity) SELECT ?,? WHERE EXISTS(SELECT 1 FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=? AND t.paid_attempt=? AND t.state='encoding' AND r.lifecycle='active' AND r.input_revision=t.revision)").bind(id,identity,id,attempt),
   ...parts.map(part=>db.prepare("INSERT OR IGNORE INTO transcription_parts(transcription_id,part_index,offset_ms,duration_ms,source_sha256,audio_key,paid_attempt) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM transcription_part_manifests WHERE transcription_id=? AND identity=?) AND EXISTS(SELECT 1 FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=? AND t.paid_attempt=? AND t.state='encoding' AND r.lifecycle='active' AND r.input_revision=t.revision)").bind(id,part.index,part.offsetMs,part.durationMs,hash,part.audioKey,attempt,id,identity,id,attempt)),
  ]);
  const rows=await list(id);
  if(rows.length!==parts.length||rows.some((row,index)=>row.source_sha256!==hash||row.offset_ms!==parts[index].offsetMs||row.duration_ms!==parts[index].durationMs||row.audio_key!==parts[index].audioKey))throw new Error('Transcription part identity changed or was revoked.');
  // A retry only adopts unsubmitted or known-failed parts. Completed parts keep their paid identity.
  await db.prepare("UPDATE transcription_parts SET state='queued',paid_attempt=?,provider_identity=NULL,receipt_key=NULL,request_id=NULL,submitted_at=NULL,charge_units=NULL WHERE transcription_id=? AND paid_attempt<? AND state IN ('queued','failed') AND (submitted_at IS NULL OR charge_units IS NOT NULL) AND EXISTS(SELECT 1 FROM processing_budget b WHERE b.id=CASE WHEN transcription_parts.paid_attempt=0 THEN transcription_parts.transcription_id ELSE transcription_parts.transcription_id||'-attempt-'||transcription_parts.paid_attempt END AND b.state='settled') AND EXISTS(SELECT 1 FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=? AND t.paid_attempt=? AND t.state='encoding' AND r.lifecycle='active' AND r.input_revision=t.revision)").bind(attempt,id,attempt,id,attempt).run();
  return list(id);
 }
 async function claim(id:string,index:number,attempt:number,reviewId:string){
  const call=transcriptionAttemptId(id,attempt),identity=call+'-part-'+index,receipt=`transcripts/${reviewId}/${identity}.provider.json`;
  return db.prepare(`UPDATE transcription_parts SET state='submitting',provider_identity=?,receipt_key=?,submitted_at=? WHERE transcription_id=? AND part_index=? AND paid_attempt=? AND state='queued' AND ${active}
   AND EXISTS(SELECT 1 FROM transcriptions WHERE id=? AND review_id=?)
   AND EXISTS(SELECT 1 FROM processing_budget WHERE id=? AND state='reserved' AND reserved_units>=(SELECT COALESCE(SUM(CASE WHEN submitted_at IS NULL THEN 2000000 ELSE COALESCE(charge_units,2000000) END),0) FROM transcription_parts WHERE transcription_id=? AND paid_attempt=?))
   AND NOT EXISTS(SELECT 1 FROM transcription_parts other WHERE other.transcription_id=? AND other.state IN ('submitting','unknown')) RETURNING *`).bind(identity,receipt,Date.now(),id,index,attempt,id,reviewId,call,id,attempt,id).first<TranscriptionPart>();
 }
 async function outcome(id:string,index:number,attempt:number,result:{state:'ready'|'failed'|'unknown';chargeUnits:number|null;requestId?:string|null}){
  if(result.chargeUnits!==null)z.number().int().min(0).max(2000000).parse(result.chargeUnits);
  if(result.state!=='unknown'&&result.chargeUnits===null)throw new Error('A resolved part needs known billing.');
  await db.prepare(`UPDATE transcription_parts SET state=CASE WHEN EXISTS(SELECT 1 FROM transcriptions t JOIN reviews r ON r.id=t.review_id AND r.owner_id=t.owner_id WHERE t.id=transcription_parts.transcription_id AND t.paid_attempt=? AND t.state<>'cancelled' AND r.lifecycle='active' AND r.input_revision=t.revision) THEN ? ELSE 'cancelled' END,charge_units=?,request_id=COALESCE(?,request_id) WHERE transcription_id=? AND part_index=? AND paid_attempt=? AND submitted_at IS NOT NULL AND (state IN ('submitting','unknown') OR (state='cancelled' AND charge_units IS NULL))`).bind(attempt,result.state,result.chargeUnits,result.requestId??null,id,index,attempt).run();
 }
 async function attemptCharge(id:string,attempt:number){
  const rows=(await list(id)).filter(row=>row.paid_attempt===attempt);
  if(rows.some(row=>row.submitted_at!==null&&row.charge_units===null))return null;
  return rows.reduce((sum,row)=>sum+(row.charge_units??0),0);
 }
 return {list,initialize,claim,outcome,attemptCharge};
}
