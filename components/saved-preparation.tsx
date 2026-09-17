'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import type {CoachingSources} from '@/lib/coaching';
import type {Preparation,SavedAnswer} from '@/lib/preparation';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
function usePreparation(reviewId:string) {
 const me=useQuery({queryKey:['me'],queryFn:()=>api<{id:string}>('/api/me')});
 const key=['preparation',me.data?.id,reviewId];
 return {key,query:useQuery({queryKey:key,queryFn:()=>api<Preparation>(`/api/reviews/${reviewId}/preparation`),enabled:Boolean(me.data?.id)})};
}
type AnswerDraft={jobId:string;proposal:string};
function useAnswerDrafts(reviewId:string) {
 const {key}=usePreparation(reviewId);
 const draftKey=[...key,'drafts'];
 const query=useQuery({queryKey:draftKey,queryFn:()=>[] as AnswerDraft[],initialData:[] as AnswerDraft[],enabled:false,staleTime:Infinity});
 return {draftKey,drafts:query.data};
}
export function FutureAnswerEditor({reviewId,jobId,proposal}:{reviewId:string;jobId:string;proposal:string}) {
 const client=useQueryClient(),{draftKey}=useAnswerDrafts(reviewId);
 return <Button onClick={()=>{client.setQueryData<AnswerDraft[]>(draftKey,current=>current?.some(d=>d.jobId===jobId)?current:[...(current??[]),{jobId,proposal}]);document.getElementById('saved-preparation')?.scrollIntoView({behavior:'smooth'});}}>Edit future answer</Button>;
}
function AnswerForm({reviewId,jobId,initialText,saved}:{reviewId:string;jobId:string;initialText:string;saved?:SavedAnswer}) {
 const client=useQueryClient(),{key,query}=usePreparation(reviewId);
 const [text,setText]=useState(saved?.text??initialText),[version,setVersion]=useState(saved?.version??0),[message,setMessage]=useState('');
 const conflict=(saved?.version??0)>version;
 const save=useMutation({mutationFn:()=>api<SavedAnswer>(`/api/reviews/${reviewId}/preparation`,{method:'POST',body:JSON.stringify({jobId,version,text})}),onSuccess:answer=>{
  setVersion(answer.version);setText(answer.text);setMessage('Future answer saved.');
  client.setQueryData<Preparation>(key,current=>current?{...current,answers:current.answers.some(a=>a.jobId===jobId&&a.version>answer.version)?current.answers:[answer,...current.answers.filter(a=>a.jobId!==jobId)]}:current);
 },onError:()=>{void client.invalidateQueries({queryKey:key});}});
 const reload=useMutation({mutationFn:()=>query.refetch({throwOnError:true}),onSuccess:latest=>{
  const answer=latest.data?.answers.find(a=>a.jobId===jobId);
  if(!answer)return;
  setVersion(answer.version);setText(answer.text);save.reset();setMessage('');
 }});
 return <form className="space-y-2" onSubmit={event=>{event.preventDefault();save.mutate();}}>
  <fieldset disabled={save.isPending||reload.isPending} className="space-y-2"><label className="block">Your future answer<Textarea value={text} maxLength={10000} required onChange={e=>{setText(e.target.value);setMessage('');}} /></label>
  <p className="text-sm">Preparation only. Saving does not change the transcript, verify new facts, or start analysis.</p>
  {conflict&&<p role="alert">A newer answer was saved elsewhere. Your draft is still here.</p>}
  {(conflict||save.isError)&&<Button type="button" variant="outline" onClick={()=>reload.mutate()}>{reload.isPending?'Loading saved answer…':'Load latest saved answer'}</Button>}
  <Button type="submit" disabled={conflict||!text.trim()}>{save.isPending?'Saving…':'Save future answer'}</Button></fieldset>
  {reload.error&&<p role="alert">Unable to load the latest answer. Your draft is preserved. Try again.</p>}{save.error&&<p role="alert">{save.error.message}</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
function PrioritiesForm({reviewId,saved}:{reviewId:string;saved:Preparation['priorities']}) {
 const client=useQueryClient(),{key,query}=usePreparation(reviewId);
 const [items,setItems]=useState(saved.items),[version,setVersion]=useState(saved.version),[message,setMessage]=useState('');
 const conflict=saved.version>version;
 const save=useMutation({mutationFn:()=>api<Preparation['priorities']>(`/api/reviews/${reviewId}/preparation`,{method:'PUT',body:JSON.stringify({version,items:items.map(s=>s.trim()).filter(Boolean)})}),onSuccess:next=>{setVersion(next.version);setItems(next.items);setMessage('Priorities saved.');client.setQueryData<Preparation>(key,current=>current?{...current,priorities:current.priorities.version>next.version?current.priorities:next}:current);},onError:()=>{void client.invalidateQueries({queryKey:key});}});
 const reload=useMutation({mutationFn:()=>query.refetch({throwOnError:true}),onSuccess:latest=>{
  if(!latest.data)return;
  setItems(latest.data.priorities.items);setVersion(latest.data.priorities.version);save.reset();setMessage('');
 }});
 return <form onSubmit={e=>{e.preventDefault();save.mutate();}} className="space-y-2"><fieldset disabled={save.isPending||reload.isPending} className="space-y-2"><legend className="font-medium">Up to three preparation priorities</legend>
 {[0,1,2].map(i=><label className="block" key={i}>Priority {i+1}<Textarea maxLength={500} value={items[i]??''} onChange={e=>{setItems(Array.from({length:3},(_,j)=>j===i?e.target.value:items[j]??''));setMessage('');}}/></label>)}
 {conflict&&<p role="alert">Newer priorities were saved elsewhere. Your draft is still here.</p>}
 {(conflict||save.isError)&&<Button type="button" variant="outline" onClick={()=>reload.mutate()}>{reload.isPending?'Loading priorities…':'Load latest priorities'}</Button>}
 <Button type="submit" disabled={conflict}>{save.isPending?'Saving…':'Save priorities'}</Button></fieldset>{reload.error&&<p role="alert">Unable to load the latest priorities. Your draft is preserved. Try again.</p>}{save.error&&<p role="alert">{save.error.message}</p>}{message&&<p role="status">{message}</p>}</form>;
}
function SavedEvidence({reviewId,answer}:{reviewId:string;answer:SavedAnswer}) {
 const [open,setOpen]=useState(false);
 const {key}=usePreparation(reviewId);
 const query=useQuery({queryKey:[...key,'evidence',answer.id],enabled:open,queryFn:()=>api<{sources:CoachingSources}>(`/api/reviews/${reviewId}/preparation?answer=${encodeURIComponent(answer.id)}`)});
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Evidence from this saved answer’s original snapshot</summary>
 {query.error&&<p role="alert">Unable to load saved evidence. Close and reopen to retry.</p>}
 {query.data&&<><p>Recorded answer passages</p>{query.data.sources.answers.map(source=><blockquote key={source.sourceId}>{source.quote}</blockquote>)}
 {(query.data.sources.context??[]).map(source=><blockquote key={source.sourceId}><p>{source.label} — selected context, not recorded speech</p>{source.quote}</blockquote>)}</>}
 </details>;
}
export function SavedPreparation({reviewId}:{reviewId:string}) {
 const {query}=usePreparation(reviewId),{drafts}=useAnswerDrafts(reviewId);
 if(query.error&&!query.data)return <p role="alert">Unable to load saved preparation. Reload to retry.</p>;
 if(!query.data)return null;
 const entries=[...query.data.answers.map(answer=>({jobId:answer.jobId,proposal:answer.text,saved:answer})),...drafts.filter(draft=>!query.data!.answers.some(answer=>answer.jobId===draft.jobId)).map(draft=>({...draft,saved:undefined}))];
 return <section id="saved-preparation" className="my-6 space-y-4 rounded-md border p-4" aria-label="Saved preparation"><h3 className="font-semibold">Saved preparation</h3>{query.error&&<p role="alert">Unable to refresh saved preparation. Your open drafts are preserved.</p>}
 <p>These are your future answers and preparation priorities. Earlier answers stay attached to their original question and coaching result when inputs change.</p>
 <PrioritiesForm key={reviewId} reviewId={reviewId} saved={query.data.priorities}/>
 {entries.map(entry=><details key={entry.jobId} open><summary className="cursor-pointer">{entry.saved?`Saved answer: ${entry.saved.question}`:'Unsaved future answer'}</summary>{entry.saved&&<p className="text-sm">Saved revision {entry.saved.version} · Original thread retained</p>}<AnswerForm reviewId={reviewId} jobId={entry.jobId} initialText={entry.proposal} saved={entry.saved}/>{entry.saved&&<SavedEvidence reviewId={reviewId} answer={entry.saved}/>}</details>)}
 </section>;
}
