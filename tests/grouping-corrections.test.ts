import {expect,test} from 'vitest';
import {correctAttribution,resolveManualGroups,inheritGroupingCoverage} from '../lib/grouping-corrections';
import type {Transcript} from '../lib/transcript';
const transcript:Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'audio',durationMs:4000,utterances:[{id:'q',speaker:'A',text:'Why?',startMs:0,endMs:1000,overlap:false},{id:'a',speaker:'B',text:'Yes yes 🧑🏽‍💻.',startMs:1000,endMs:2000,overlap:false},{id:'f',speaker:'C',text:'How?',startMs:2000,endMs:3000,overlap:false},{id:'u',speaker:null,text:'My answer.',startMs:3000,endMs:4000,overlap:true}]};
const groups=[{key:'root',question:[{utteranceId:'q',start:0,end:4}],answers:[{utteranceId:'a',start:4,end:7}],parent:null},{key:'follow',question:[{utteranceId:'f',start:0,end:4}],answers:[],parent:'root'}];
test('manual spans disambiguate repeated text and retain enclosing audio and panel follow-ups',()=>{const result=resolveManualGroups(groups,transcript,'v2',['B']);expect(result[0].answers[0]).toMatchObject({quote:'yes',start:4,end:7,startMs:1000,endMs:2000});expect(result[1].parentId).toBe(result[0].id);});
test('rejects foreign spans, backwards answers, duplicate parents, wrong roles and cycles',()=>{
 const invalid=[[{...groups[0],question:[{utteranceId:'foreign',start:0,end:4}]}],[groups[0],{...groups[0],key:'duplicate'}],[{...groups[0],question:groups[1].question}],[{...groups[0],answers:groups[0].question}],[{...groups[0],parent:'follow'},groups[1]]];for(const input of invalid)expect(()=>resolveManualGroups(input,transcript,'v2',['B'])).toThrow();
 expect(()=>resolveManualGroups([{...groups[0],answers:[{utteranceId:'a',start:9,end:10}]}],transcript,'v2',['B'])).toThrow();
});
test('local attribution repairs unknown/overlapping speech while preserving the initial evidence',()=>{
 const corrected=correctAttribution(transcript,{transcriptId:'v1',candidateSpeakers:['B'],passages:[{utteranceId:'u',role:'candidate',overlap:false}]},'version');expect(corrected.candidateSpeakers).toEqual(['B','candidate-version']);expect(corrected.transcript.utterances[3]).toMatchObject({speaker:'candidate-version',overlap:false,startMs:3000,endMs:4000});expect(transcript.utterances[3].speaker).toBeNull();expect(transcript.utterances[3].overlap).toBe(true);
});

test('coverage follows unchanged passage identities when byte-based window boundaries move',()=>{
 const before={...transcript,utterances:Array.from({length:30},(_,i)=>({id:'u'+i,speaker:i%2?'B':'A',text:'x'.repeat(i<4?50000:1000),startMs:i*1000,endMs:(i+1)*1000,overlap:false}))};
 const after={...before,utterances:before.utterances.map((u,i)=>i===0?{...u,text:'short'}:u)};
 // Only the first old window was analyzed. Shrinking unselected u0 moves
 // previously unprocessed later passages into ordinal zero.
 expect(inheritGroupingCoverage(before,after,[0])).toEqual([]);
 const unchanged={...before,utterances:before.utterances.map(u=>({...u}))};expect(inheritGroupingCoverage(before,unchanged,[0])).toEqual([0]);
});
