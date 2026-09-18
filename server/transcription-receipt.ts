import {z} from 'zod';
import {parseTranscript,transcriptSchema} from '../lib/transcript';
const aggregateHeader=z.object({kind:z.literal('transcription-parts-v1'),callId:z.string().min(1),chargeUnits:z.number().int().nonnegative().max(6000000)});
const providerReceipt=z.object({response:z.string().max(8000000)});
const usageSchema=z.object({usage:z.object({type:z.literal('tokens'),input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()})});
function aggregate(receipt:unknown,callId:string){
 if(typeof receipt!=='object'||receipt===null||!('kind' in receipt))return null;
 const header=aggregateHeader.parse(receipt);
 if(header.callId!==callId)throw new Error('Saved transcription belongs to another paid attempt.');
 return header;
}
/** Only the application-owned envelope can declare an assembled result. */
export function transcriptionReceiptCharge(receipt:unknown,callId:string):number|null {
 const header=aggregate(receipt,callId);if(header)return header.chargeUnits;
 const usage=usageSchema.safeParse(JSON.parse(providerReceipt.parse(receipt).response));
 return usage.success?Math.ceil(usage.data.usage.input_tokens*2.5+usage.data.usage.output_tokens*10):null;
}
export function transcriptionReceiptTranscript(receipt:unknown,callId:string,id:string,sha256:string,durationMs:number){
 if(!aggregate(receipt,callId))return parseTranscript(JSON.parse(providerReceipt.parse(receipt).response),id,sha256,durationMs).transcript;
 const {transcript}=z.object({transcript:transcriptSchema}).parse(receipt);
 if(transcript.audioSha256!==sha256||transcript.durationMs!==durationMs)throw new Error('Saved transcription source changed.');
 const seen=new Set<string>();let previousStart=-1;
 for(const utterance of transcript.utterances){
  if(!utterance.id.startsWith(id+':part-')||seen.has(utterance.id)||utterance.startMs<previousStart||utterance.endMs<=utterance.startMs||utterance.endMs>durationMs)throw new Error('Saved transcription passages are invalid.');
  seen.add(utterance.id);previousStart=utterance.startMs;
 }
 return transcript;
}
