import {test,expect} from 'vitest';
import {decodeTranscriptionParts} from '../lib/transcription-parts';
const chunks=[{index:0,offsetMs:0,durationMs:1200000,bytes:2},{index:1,offsetMs:1200000,durationMs:1200000,bytes:3},{index:2,offsetMs:2400000,durationMs:1200000,bytes:1}];
function bundle(parts=chunks,body=new Uint8Array([1,2,3,4,5,6])){
 const header=new TextEncoder().encode(JSON.stringify({version:1,chunks:parts})),bytes=new Uint8Array(4+header.length+body.length);
 new DataView(bytes.buffer).setUint32(0,header.length);bytes.set(header,4);bytes.set(body,4+header.length);return bytes.buffer;
}
test('decodes all parts without gaps, truncation, or changing original offsets',()=>{
 const result=decodeTranscriptionParts(bundle(),3600000);
 expect(result.map(part=>Array.from(part.audio))).toEqual([[1,2],[3,4,5],[6]]);
 expect(result.map(part=>part.offsetMs)).toEqual([0,1200000,2400000]);
});
test('rejects gaps, duplicate indexes, excessive duration and incomplete payloads',()=>{
 for(const change of [{offsetMs:1200001},{index:0},{durationMs:1400001},{bytes:4}])expect(()=>decodeTranscriptionParts(bundle([chunks[0],{...chunks[1],...change},chunks[2]]),3600000)).toThrow();
 expect(()=>decodeTranscriptionParts(bundle(),3599000)).toThrow();
 expect(()=>decodeTranscriptionParts(bundle(chunks,new Uint8Array(7)),3600000)).toThrow();
 expect(()=>decodeTranscriptionParts(new ArrayBuffer(3),3600000)).toThrow();
});
