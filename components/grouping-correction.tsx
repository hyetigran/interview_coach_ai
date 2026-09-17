'use client';
import {useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import type {Transcript} from '@/lib/transcript';
import type {QuestionGroup} from '@/lib/threads';
import type {ManualGroups} from '@/lib/grouping-corrections';
import {Button} from './ui/button';
export type EditableGrouping={id:string;transcriptId:string;version:number;groups:QuestionGroup[]};
type Draft={base:EditableGrouping;transcript:Transcript;groups:ManualGroups};
export function GroupingCorrection({reviewId,current}:{reviewId:string;current:EditableGrouping|null}) {
 const client=useQueryClient(),[draft,setDraft]=useState<Draft|null>(null),[selected,setSelected]=useState(''),[target,setTarget]=useState(''),[role,setRole]=useState<'question'|'answers'>('answers'),[message,setMessage]=useState('');
 const text=useRef<HTMLTextAreaElement>(null),selection=useRef({start:0,end:0});
 const load=useMutation({mutationFn:async()=>{
  const base=await api<EditableGrouping|null>(`/api/reviews/${reviewId}/threads`),document=await api<{id:string;transcript:Transcript}>(`/api/reviews/${reviewId}/transcript`);
  if(!base?.id||base.transcriptId!==document.id||!document.transcript)throw new Error('Refresh analysis before editing the current question groups. Your draft is preserved.');
  const span=({utteranceId,start,end}:{utteranceId:string;start:number;end:number})=>({utteranceId,start,end});
  return {base,transcript:document.transcript,groups:base.groups.map(g=>({key:g.id,question:g.question.map(span),answers:g.answers.map(span),parent:g.parentId}))};
 },onSuccess:next=>{setDraft(next);setSelected(next.transcript.utterances[0]?.id??'');setTarget(next.groups[0]?.key??'');setMessage('');save.reset();}});
 const save=useMutation({mutationFn:()=>{if(!draft)throw new Error('Open a grouping draft first.');return api(`/api/reviews/${reviewId}/threads`,{method:'PUT',body:JSON.stringify({transcriptId:draft.base.transcriptId,groupingId:draft.base.id,version:draft.base.version,groups:draft.groups})});},onSuccess:()=>{setDraft(null);setMessage('Question grouping saved. Refresh analysis when ready.');for(const key of ['transcript','threads','speakers','coaching','attribution'])void client.invalidateQueries({queryKey:[key,reviewId]});}});
 const stale=!!draft&&(!current||current.id!==draft.base.id||current.version!==draft.base.version);
 const passage=draft?.transcript.utterances.find(u=>u.id===selected);
 function addSelection(all:boolean) {
  if(!draft||!passage||!target||!text.current)return;
  const start=all?0:selection.current.start,end=all?passage.text.length:selection.current.end;
  if(start===end){setMessage('Highlight words in the passage, or use the whole passage.');return;}
  const span={utteranceId:passage.id,start,end};setDraft({...draft,groups:draft.groups.map(g=>g.key===target?{...g,[role]:[...g[role],span]}:g)});setMessage('Passage added to the draft.');
 }
 const quote=(span:ManualGroups[number]['question'][number])=>draft?.transcript.utterances.find(u=>u.id===span.utteranceId)?.text.slice(span.start,span.end)??'Unavailable passage';
 return <details className="border rounded-md p-3"><summary className="cursor-pointer">Correct question groups</summary>
 <p>Adjust recorded question and answer passages, or link a follow-up to an earlier question. Saved preparation stays with its original thread. After refreshing, review earlier preparation and copy relevant text into the corrected thread explicitly.</p>
 {!draft&&<Button type="button" disabled={load.isPending||!current} onClick={()=>load.mutate()}>Edit question groups</Button>}
 {draft&&<form onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending||load.isPending} className="space-y-3">
 {draft.groups.map((g,index)=><fieldset key={g.key} className="border p-3"><legend>Question group {index+1}</legend>
 {(['question','answers'] as const).map(kind=><div key={kind}><h5>{kind==='question'?'Question passages':'Answer passages'}</h5><ol>{g[kind].map((span,i)=><li key={`${span.utteranceId}-${span.start}-${span.end}-${i}`}><blockquote>{quote(span)}</blockquote><Button type="button" variant="outline" onClick={()=>setDraft({...draft,groups:draft.groups.map(item=>item.key===g.key?{...item,[kind]:item[kind].filter((_,n)=>n!==i)}:item)})}>Remove {kind==='question'?'question':'answer'} passage {i+1} from group {index+1}</Button></li>)}</ol></div>)}
 <label>Follow-up parent for group {index+1}<select value={g.parent??''} onChange={e=>setDraft({...draft,groups:draft.groups.map(item=>item.key===g.key?{...item,parent:e.target.value||null}:item)})}><option value="">Standalone question</option>{draft.groups.filter(item=>item.key!==g.key).map(item=><option key={item.key} value={item.key}>Group {draft.groups.indexOf(item)+1}: {item.question.map(quote).join(' ').slice(0,100)}</option>)}</select></label>
 <Button type="button" variant="outline" onClick={()=>{setDraft({...draft,groups:draft.groups.filter(item=>item.key!==g.key).map(item=>item.parent===g.key?{...item,parent:null}:item)});if(target===g.key)setTarget('');}}>Remove group {index+1}</Button>
 </fieldset>)}
 <Button type="button" variant="outline" onClick={()=>{const key=crypto.randomUUID();setDraft({...draft,groups:[...draft.groups,{key,question:[],answers:[],parent:null}]});setTarget(key);setRole('question');}}>Add question group</Button>
 <fieldset className="space-y-2"><legend>Add recorded evidence</legend>
 <label>Destination group<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose a group</option>{draft.groups.map((g,i)=><option key={g.key} value={g.key}>Group {i+1}</option>)}</select></label>
 <label>Evidence role<select value={role} onChange={e=>setRole(e.target.value as 'question'|'answers')}><option value="question">Question</option><option value="answers">Answer</option></select></label>
 <label>Recorded passage<select value={selected} onChange={e=>{selection.current={start:0,end:0};setSelected(e.target.value);}}>{draft.transcript.utterances.map(u=><option key={u.id} value={u.id}>{u.startMs/1000}s: {u.text.slice(0,100)}</option>)}</select></label>
 <label className="block">Highlight recorded words<textarea key={selected} ref={text} onSelect={e=>{const {selectionStart:start,selectionEnd:end}=e.currentTarget;if(end>start)selection.current={start,end};}} readOnly value={passage?.text??''} className="block w-full border p-2" rows={4}/></label>
 <p>Use Shift and arrow keys to select words. Audio timing remains the enclosing passage.</p><Button type="button" disabled={!target} onClick={()=>addSelection(false)}>Add highlighted words</Button><Button type="button" disabled={!target} onClick={()=>addSelection(true)}>Add whole passage</Button>
 </fieldset>
 {stale&&<p role="alert">Question groups changed. Your draft is preserved; load the latest groups before saving.</p>}
 <Button type="submit" disabled={stale}>Save question grouping</Button><Button type="button" variant="outline" onClick={()=>load.mutate()}>Discard draft and load latest groups</Button>
 </fieldset></form>}
 {(load.error||save.error)&&<p role="alert">{(load.error||save.error)?.message}</p>}{message&&<p role="status">{message}</p>}
 </details>;
}
