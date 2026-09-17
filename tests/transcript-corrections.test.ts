import {expect,test} from 'vitest';
import {correctUtterance,reusableGroupingPrefix,correctionSchema} from '../lib/transcript-corrections';
import type {Transcript} from '../lib/transcript';
const transcript:Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'original-hash',durationMs:60000,utterances:Array.from({length:60},(_,i)=>({id:'u'+i,speaker:i%2?'B':'A',text:'Repeated phrase 🧑🏽‍💻 café. Repeated phrase.',startMs:i*1000,endMs:(i+1)*1000,overlap:false}))};
test('correction addresses one stable utterance and preserves original evidence and enclosing audio',()=>{
 const corrected=correctUtterance(transcript,'u30','Corrected Unicode 🧑🏽‍💻 café.');expect(transcript.utterances[30].text).toContain('Repeated');expect(corrected.utterances[30]).toEqual({...transcript.utterances[30],text:'Corrected Unicode 🧑🏽‍💻 café.',corrected:true});expect(corrected.utterances[29]).toEqual(transcript.utterances[29]);expect(corrected.audioSha256).toBe(transcript.audioSha256);
});
test('dependencies include uncited text and metadata and invalidate downstream carried questions',()=>{
 expect(reusableGroupingPrefix(transcript,correctUtterance(transcript,'u30','Different wording'))).toEqual({reusablePrefix:1,total:3});
 const metadata=structuredClone(transcript);metadata.utterances[30].overlap=true;expect(reusableGroupingPrefix(transcript,metadata).reusablePrefix).toBe(1);
 expect(reusableGroupingPrefix(transcript,transcript).reusablePrefix).toBe(3);
});
test('wording corrections require an explicit recording-only declaration',()=>{
 expect(()=>correctionSchema.parse({transcriptId:'t',utteranceId:'u',text:'A new achievement',recordingOnly:false})).toThrow();
});
