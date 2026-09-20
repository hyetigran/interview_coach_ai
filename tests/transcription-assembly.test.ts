import {test,expect} from 'vitest';
import {assembleTranscriptionParts} from '../lib/transcription-assembly';
import {resolveGroups} from '../lib/threads';
import {resolveManualGroups,attributionSchema,correctAttribution} from '../lib/grouping-corrections';
const hash='a'.repeat(64);
const parts=Array.from({length:3},(_,index)=>({index,offsetMs:index*1200000,durationMs:1200000,response:{duration:1200,segments:[
 {speaker:'A',text:`Question ${index}?`,start:0,end:1},
 {speaker:'B',text:`Answer ${index}.`,start:2,end:3},
 {speaker:'A',text:`Ending ${index}.`,start:1199,end:1200},
]}}));
test('assembles the complete original timeline without merging independent speaker identities',()=>{
 const transcript=assembleTranscriptionParts('t',hash,3600000,parts);
 expect(transcript.utterances).toHaveLength(9);
 expect(transcript.utterances.map(u=>u.startMs)).toEqual([0,2000,1199000,1200000,1202000,2399000,2400000,2402000,3599000]);
 expect(new Set(transcript.utterances.map(u=>u.id)).size).toBe(9);
 expect(new Set(transcript.utterances.map(u=>u.speaker)).size).toBe(6);
 expect(transcript.utterances[0].speaker).toBe('Part 1 / A');
 expect(transcript.utterances[3].speaker).toBe('Part 2 / A');
 expect(transcript.utterances.at(-1)?.endMs).toBe(3600000);
 expect(transcript.audioSha256).toBe(hash);
});
test('boundary uncertainty survives evidence resolution without inventing overlapping speech',()=>{
 const transcript=assembleTranscriptionParts('t',hash,3600000,parts);
 expect(transcript.utterances.map(u=>Boolean(u.boundaryUncertain))).toEqual([false,false,true,true,true,true,true,true,false]);
 expect(transcript.utterances.every(u=>!u.overlap)).toBe(true);
 const q=transcript.utterances[3],a=transcript.utterances[4];
 const groups=resolveGroups({groups:[{question:[{utteranceId:q.id,quote:q.text}],answers:[{utteranceId:a.id,quote:a.text}],parent:null,uncertain:false}]},transcript,'t',[a.speaker!]);
 expect(groups[0].uncertain).toBe(true);
 expect(groups[0].question[0].uncertain).toBe(true);
 const corrected=correctAttribution(transcript,{transcriptId:'t',candidateSpeakers:[a.speaker!],passages:[{utteranceId:q.id,role:'interviewer',overlap:false}]},'v2');
 const manual=resolveManualGroups([{key:'q',question:[{utteranceId:q.id,start:0,end:q.text.length}],answers:[{utteranceId:a.id,start:0,end:a.text.length}],parent:null}],corrected.transcript,'v2',corrected.candidateSpeakers);
 expect(manual[0].question[0].uncertain).toBe(true);
});
test('rejects missing, reordered, overlong, gapped or mismatched provider parts',()=>{
 for(const changed of [parts.slice(0,2),[parts[1],parts[0],parts[2]],[parts[0],{...parts[1],offsetMs:1200001},parts[2]],[{...parts[0],durationMs:1400000},...parts.slice(1)],[{...parts[0],response:{...parts[0].response,duration:1100}},...parts.slice(1)]])
  expect(()=>assembleTranscriptionParts('t',hash,3600000,changed)).toThrow();
});
test('empty speech parts preserve recording duration and unidentified speakers stay unidentified',()=>{
 const transcript=assembleTranscriptionParts('t',hash,3600000,parts.map((part,index)=>({...part,response:{...part.response,segments:index===1?[]:part.response.segments.map(segment=>({...segment,speaker:null}))}})));
 expect(transcript.durationMs).toBe(3600000);
 expect(transcript.utterances).toHaveLength(6);
 expect(transcript.utterances.every(u=>u.speaker===null)).toBe(true);
});

test('maximum provider speaker labels remain selectable after part scoping',()=>{
 const part={...parts[0],response:{...parts[0].response,segments:[{speaker:'x'.repeat(100),text:'My answer.',start:0,end:1}]}};
 const transcript=assembleTranscriptionParts('t',hash,1200000,[part]);
 expect(attributionSchema.parse({transcriptId:'t',candidateSpeakers:[transcript.utterances[0].speaker],passages:[]}).candidateSpeakers).toHaveLength(1);
});

test('empty speaker IDs remain uncertain away from processing boundaries',()=>{
 for(const speaker of ['', '   ']){
  const response={duration:1200,segments:[{speaker,text:'Why?',start:10,end:11},{speaker:'B',text:'My answer.',start:12,end:13}]};
  const transcript=assembleTranscriptionParts('t',hash,1200000,[{index:0,offsetMs:0,durationMs:1200000,response}]);
  const [q,a]=transcript.utterances;
  expect(q.speaker).toBeNull();expect(q.boundaryUncertain).toBe(false);
  const automatic=resolveGroups({groups:[{question:[{utteranceId:q.id,quote:q.text}],answers:[{utteranceId:a.id,quote:a.text}],parent:null,uncertain:false}]},transcript,'t',[a.speaker!]);
  const manual=resolveManualGroups([{key:'q',question:[{utteranceId:q.id,start:0,end:q.text.length}],answers:[{utteranceId:a.id,start:0,end:a.text.length}],parent:null}],transcript,'t',[a.speaker!]);
  expect(automatic[0].question[0].uncertain).toBe(true);
  expect(manual[0].question[0].uncertain).toBe(true);
 }
});
