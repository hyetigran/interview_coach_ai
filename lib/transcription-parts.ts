import {z} from 'zod';
const partSchema=z.object({index:z.number().int().min(0).max(2),offsetMs:z.number().int().nonnegative(),durationMs:z.number().int().positive().max(1200000),bytes:z.number().int().positive().max(15000000)}).strict();
const manifestSchema=z.object({version:z.literal(1),chunks:z.array(partSchema).min(1).max(3)}).strict();
export function decodeTranscriptionParts(buffer:ArrayBuffer,durationMs:number){
 if(buffer.byteLength<4||buffer.byteLength>15000000)throw new Error('Invalid transcription bundle size.');
 const headerLength=new DataView(buffer).getUint32(0);
 if(headerLength>4096||headerLength+4>buffer.byteLength)throw new Error('Invalid transcription bundle header.');
 const manifest=manifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(buffer,4,headerLength))));
 let offset=0,position=4+headerLength;
 const parts=manifest.chunks.map((part,index)=>{
  if(part.index!==index||part.offsetMs!==offset||position+part.bytes>buffer.byteLength)throw new Error('Transcription parts are incomplete or out of order.');
  const audio=new Uint8Array(buffer,position,part.bytes);position+=part.bytes;offset+=part.durationMs;
  return {...part,audio};
 });
 if(offset!==durationMs||position!==buffer.byteLength)throw new Error('Transcription parts do not cover exactly the recording.');
 return parts;
}
