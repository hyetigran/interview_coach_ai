'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import type {Transcript} from '@/lib/transcript';
import {Button} from './ui/button';
type Selection={transcriptId:string;revision:number;candidateSpeakers:string[]};
type Passage={utteranceId:string;role:'candidate'|'interviewer'|'unknown';overlap:boolean};
export function speakerName(label:string|null) {
 return !label?'Unidentified speaker':label.startsWith('candidate-')?'Candidate (corrected)':label.startsWith('interviewer-')?'Interviewer (corrected)':`Speaker ${label}`;
}
export function AttributionCorrection({reviewId,transcriptId,revision,transcript}:{reviewId:string;transcriptId:string;revision:number;transcript:Transcript}) {
 const client=useQueryClient(),path=`/api/reviews/${reviewId}/attribution`;
 const query=useQuery({queryKey:['attribution',reviewId,transcriptId],queryFn:()=>api<Selection>(path)});
 const [draft,setDraft]=useState<{base:Selection;transcript:Transcript;passages:Passage[]}|null>(null),[page,setPage]=useState(0),[message,setMessage]=useState('');
 const save=useMutation({mutationFn:()=>{if(!draft)throw new Error('Open an attribution draft first.');return api<{id:string;revision:number}>(path,{method:'POST',body:JSON.stringify({transcriptId:draft.base.transcriptId,candidateSpeakers:draft.base.candidateSpeakers,passages:draft.passages})});},onSuccess:()=>{setDraft(null);setMessage('Speaker corrections saved. Refresh analysis when ready.');for(const key of ['transcript','attribution','speakers','threads','coaching'])void client.invalidateQueries({queryKey:[key,reviewId]});}});
 const load=useMutation({mutationFn:async()=>{
  const fresh=await api<{id:string;revision:number;transcript:Transcript}>(`/api/reviews/${reviewId}/transcript`),base=await api<Selection>(path);
  if(fresh.id!==base.transcriptId)throw new Error('The transcript changed while loading. Try again; your draft is preserved.');
  return {base,transcript:fresh.transcript,passages:[] as Passage[]};
 },onSuccess:next=>{setDraft(next);setPage(0);save.reset();setMessage('');}});
 const conflict=!!draft&&revision>draft.base.revision;
 const labels=[...new Set(draft?.transcript.utterances.flatMap(u=>u.speaker?[u.speaker]:[])??[])];
 function change(passage:Passage) {setDraft(d=>d?{...d,passages:[...d.passages.filter(p=>p.utteranceId!==passage.utteranceId),passage]}:d);}
 return <details className="rounded-md border p-3"><summary className="cursor-pointer">Correct speaker roles and overlap</summary>
 <p>Choose every label belonging to your voice, or correct individual passages. Original evidence is retained. Saving does not start paid analysis.</p>
 {!draft&&<Button type="button" disabled={!query.data||query.data.transcriptId!==transcriptId} onClick={()=>{if(query.data){setDraft({base:query.data,transcript,passages:[]});setMessage('');}}}>Edit speaker roles</Button>}
 {draft&&<form onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending||load.isPending} className="space-y-3">
 <fieldset><legend>Labels belonging to your voice</legend>{labels.map(label=><label key={label} className="block"><input type="checkbox" checked={draft.base.candidateSpeakers.includes(label)} onChange={e=>{const checked=e.target.checked;setDraft(d=>d?{...d,base:{...d.base,candidateSpeakers:checked?[...d.base.candidateSpeakers,label]:d.base.candidateSpeakers.filter(l=>l!==label)}}:d);}}/>{speakerName(label)}</label>)}</fieldset>
 <p>Individual passage corrections override the label selection above. Unidentified or overlapping speech remains marked as uncertain.</p>
 {draft.transcript.utterances.slice(page*50,(page+1)*50).map(u=>{const value=draft.passages.find(p=>p.utteranceId===u.id)??{utteranceId:u.id,role:!u.speaker?'unknown':draft.base.candidateSpeakers.includes(u.speaker)?'candidate':'interviewer',overlap:u.overlap};return <fieldset key={u.id} className="border p-2"><legend>Passage at {u.startMs/1000} seconds</legend><p>{u.text}</p>
 <label>Speaker role <select value={value.role} onChange={e=>change({...value,role:e.target.value as Passage['role']})}><option value="candidate">Candidate</option><option value="interviewer">Interviewer</option><option value="unknown">Unidentified</option></select></label>
 <label className="block"><input type="checkbox" checked={value.overlap} onChange={e=>change({...value,overlap:e.target.checked})}/>Overlapping speech</label>
 {draft.passages.some(p=>p.utteranceId===u.id)&&<Button type="button" variant="outline" onClick={()=>setDraft(d=>d?{...d,passages:d.passages.filter(p=>p.utteranceId!==u.id)}:d)}>Undo passage change</Button>}</fieldset>;})}
 {draft.transcript.utterances.length>50&&<div><Button type="button" disabled={page===0} onClick={()=>setPage(page-1)}>Previous speaker passages</Button><Button type="button" disabled={(page+1)*50>=draft.transcript.utterances.length} onClick={()=>setPage(page+1)}>Next speaker passages</Button></div>}
 {conflict&&<p role="alert">A newer transcript is available. Your draft is preserved.</p>}
 <Button type="submit" disabled={conflict}>Save speaker corrections</Button><Button type="button" variant="outline" onClick={()=>load.mutate()}>Discard draft and load latest speaker roles</Button>
 </fieldset></form>}
 {(save.error||load.error||query.error)&&<p role="alert">{(save.error||load.error||query.error)?.message}</p>}{message&&<p role="status">{message}</p>}
 </details>;
}
