import { expect, test } from 'vitest';
import { resolveGroups, groupingWindows, mergeGroups } from '../lib/threads';
import type { Transcript } from '../lib/transcript';
const transcript: Transcript = { version:1, model:'gpt-4o-transcribe-diarize', audioSha256:'hash',durationMs:9000,utterances:[
  {id:'q',speaker:'A',text:'👋 Why? Why?',startMs:0,endMs:1000,overlap:false},
  {id:'a',speaker:'B',text:'I shipped it.',startMs:1000,endMs:2000,overlap:false},
  {id:'f',speaker:'C',text:'What changed?',startMs:2000,endMs:3000,overlap:false},
  {id:'b',speaker:'B',text:'Latency fell.',startMs:3000,endMs:4000,overlap:false},
]};
const ref = (utteranceId:string,quote:string) => ({utteranceId,quote});
const root = {question:[ref('q','👋 Why? Why?')],answers:[ref('a','I shipped it.')],parent:null,uncertain:false};
test('resolves exact UTF-16 spans and existing audio, panel follow-ups and noncontiguous answers', () => {
  const groups=resolveGroups({groups:[root,{question:[ref('f','What changed?')],answers:[ref('b','Latency fell.')],parent:ref('q','👋 Why? Why?'),uncertain:false}]},transcript,'v1',['B']);
  expect(groups[0].question[0]).toMatchObject({start:0,end:12,startMs:0,endMs:1000,transcriptId:'v1'});
  expect(groups[1].parentId).toBe(groups[0].id);
  expect(resolveGroups({groups:[{...root,answers:[]}]},transcript,'v1',['B'])[0].answers).toEqual([]);
});
test('rejects ambiguous repeats, unknown sources, candidate questions, invented times and forward/cyclic parents', () => {
  for(const bad of [ {...root,question:[ref('q','Why?')]}, {...root,answers:[ref('unknown','text')]}, {...root,question:[ref('a','I shipped it.')]}, {...root,startMs:123}, {...root,parent:ref('f','What changed?')} ]) expect(()=>resolveGroups({groups:[bad]},transcript,'v1',['B'])).toThrow();
});
test('overlap merges stable identities and supports follow-ups whose roots are in an earlier chunk', () => {
  const first=resolveGroups({groups:[root]},transcript,'v1',['B']);
  const second=resolveGroups({groups:[root,{question:[ref('f','What changed?')],answers:[],parent:ref('q','👋 Why? Why?'),uncertain:true}]},transcript,'v1',['B']);
  const result=mergeGroups([...first,...second]); expect(result).toHaveLength(2); expect(result[1].parentId).toBe(first[0].id); expect(result[1].uncertain).toBe(true);
});
test('finite windows cover every source and overlap boundaries without modifying text',()=>{
  const source={...transcript,utterances:Array.from({length:99},(_,i)=>({...transcript.utterances[0],id:String(i)}))};
  const windows=groupingWindows(source);expect(new Set(windows.flatMap(w=>w.map(u=>u.id))).size).toBe(99);expect(windows[1][0].id).toBe('16');expect(windows.every(w=>w.length<=32)).toBe(true);
});
test('a unique clause and its complete question sentence share a stable overlap identity',()=>{
  const source={...transcript,utterances:[{...transcript.utterances[0],text:'Tell me why you chose that design?'}]};
  const a=resolveGroups({groups:[{...root,question:[ref('q','Tell me why you chose that design?')],answers:[]}]},source,'v1',['B']);
  const b=resolveGroups({groups:[{...root,question:[ref('q','why you chose that design?')],answers:[]}]},source,'v1',['B']);
  expect(a[0].id).toBe(b[0].id);expect(mergeGroups([...a,...b])).toHaveLength(1);
});
