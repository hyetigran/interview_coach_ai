'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import type {ReviewContext} from '@/lib/review-context';
import {Button} from './ui/button';
type Snapshot={id:string;revision:number;context:ReviewContext};
export function ReviewContextEditor({reviewId}:{reviewId:string}) {
 const query=useQuery({queryKey:['context',reviewId],queryFn:()=>api<Snapshot>(`/api/reviews/${reviewId}/context`)});
 const [message,setMessage]=useState('');
 if(query.error)return <p role="alert">Unable to load optional context. Reload to retry.</p>;
 if(!query.data)return <p>Loading context…</p>;
 return <details className="my-5 rounded-md border p-4"><summary className="cursor-pointer font-medium">Target role and optional background</summary>
  <p className="my-3 text-sm">Add selected resume text, a job description, or up to three experience stories. These can inform future answers; they do not change what was said in the interview.</p>
  <ContextForm key={reviewId} reviewId={reviewId} snapshot={query.data} report={setMessage}/>
  {message&&<p role="status" className="mt-3">{message}</p>}
 </details>;
}
function ContextForm({reviewId,snapshot,report}:{reviewId:string;snapshot:Snapshot;report:(message:string)=>void}) {
 const [base,setBase]=useState(snapshot);const [value,setValue]=useState(snapshot.context);const cache=useQueryClient();const dirty=JSON.stringify(value)!==JSON.stringify(base.context);const conflict=snapshot.revision!==base.revision;
 const save=useMutation({mutationFn:()=>api<Snapshot>(`/api/reviews/${reviewId}/context`,{method:'PUT',body:JSON.stringify({revision:base.revision,context:value})}),onSuccess:data=>{setBase(data);setValue(data.context);cache.setQueryData<Snapshot>(['context',reviewId],current=>current&&current.revision>data.revision?current:data);void cache.invalidateQueries({queryKey:['coaching',reviewId]});void cache.invalidateQueries({queryKey:['review']});report('Context saved. Affected coaching is outdated. Choose Reanalyze coaching to use this selection; saving does not spend processing credits.');}});
 const reanalyze=useMutation({mutationFn:()=>api(`/api/reviews/${reviewId}/coaching`,{method:'POST',body:JSON.stringify({actionId:crypto.randomUUID(),contextRevision:base.revision})}),onSuccess:()=>{void cache.invalidateQueries({queryKey:['coaching',reviewId]});report('Reanalysis requested. Current results are reused when available; new context is processed under the shared allowance.');}});
 const box='block w-full rounded-md border bg-background p-2';
 return <form className="space-y-4" onSubmit={event=>{event.preventDefault();save.mutate();}}>
  <fieldset disabled={save.isPending} className="space-y-4">
  {conflict&&<div role="status"><p>A newer context version is available. Your local edits have been kept. Loading the latest context will replace this draft.</p><Button type="button" variant="outline" onClick={()=>{setBase(snapshot);setValue(snapshot.context);}}>Load latest context</Button></div>}
  <label className="block">Target role<input className={box} required maxLength={120} value={value.role} onChange={event=>setValue({...value,role:event.target.value})}/></label>
  {(['resume','jobDescription'] as const).map(field=><fieldset key={field} className="space-y-2"><legend className="font-medium">{field==='resume'?'Resume text':'Job description'}</legend>
   <label className="block"><input type="checkbox" checked={value[field].selected} onChange={event=>setValue({...value,[field]:{...value[field],selected:event.target.checked}})}/> Use {field==='resume'?'resume text':'job description'} in future coaching</label>
   <label className="block">{field==='resume'?'Paste resume text':'Paste job description'}<textarea rows={4} maxLength={12000} className={box} value={value[field].text} onChange={event=>setValue({...value,[field]:{...value[field],text:event.target.value}})}/></label>
  </fieldset>)}
  {value.stories.map((story,index)=><fieldset key={story.id} className="space-y-2"><legend className="font-medium">Experience story {index+1}</legend><label className="block"><input type="checkbox" checked={story.selected} onChange={event=>setValue({...value,stories:value.stories.map(s=>s.id===story.id?{...s,selected:event.target.checked}:s)})}/> Use story {index+1} in future coaching</label><label className="block">Story {index+1} text<textarea rows={4} maxLength={4000} className={box} value={story.text} onChange={event=>setValue({...value,stories:value.stories.map(s=>s.id===story.id?{...s,text:event.target.value}:s)})}/></label><Button type="button" variant="outline" onClick={()=>setValue({...value,stories:value.stories.filter(s=>s.id!==story.id)})}>Remove story {index+1} from current context</Button></fieldset>)}
  <Button type="button" variant="outline" disabled={value.stories.length>=3} onClick={()=>setValue({...value,stories:[...value.stories,{id:crypto.randomUUID(),text:'',selected:true}]})}>Add experience story</Button>
  <p className="text-sm text-muted-foreground">Unchecking or removing context excludes it from future analysis. Earlier versions remain with their citations and saved work. Delete the whole review to erase retained context and results. Up to 12,000 characters per document and 4,000 per story; 64 KB total.</p>
  <div className="flex gap-3"><Button type="submit" disabled={!dirty||save.isPending}>{save.isPending?'Saving…':'Save context'}</Button><Button type="button" variant="outline" disabled={conflict||dirty||save.isPending||reanalyze.isPending} onClick={()=>reanalyze.mutate()}>Reanalyze coaching</Button></div>
  </fieldset>
  {(save.error||reanalyze.error)&&<p role="alert">{save.error?.message??reanalyze.error?.message}</p>}
 </form>;
}
