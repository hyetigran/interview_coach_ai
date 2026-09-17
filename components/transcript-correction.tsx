'use client';
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {api} from '@/lib/api';
import type {Transcript} from '@/lib/transcript';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
export function TranscriptCorrection({reviewId,transcriptId,revision,utterance}:{reviewId:string;transcriptId:string;revision:number;utterance:Transcript['utterances'][number]}) {
 const client=useQueryClient();const [text,setText]=useState(utterance.text),[base,setBase]=useState({id:transcriptId,revision}),[recordingOnly,setRecordingOnly]=useState(false),[message,setMessage]=useState('');
 const conflict=revision>base.revision;
 const save=useMutation({mutationFn:()=>api<{id:string;revision:number}>(`/api/reviews/${reviewId}/transcript`,{method:'PATCH',body:JSON.stringify({transcriptId:base.id,utteranceId:utterance.id,text,recordingOnly})}),onSuccess:async next=>{setBase(next);setText(text.trim());setMessage('Correction saved. Refresh analysis when you are ready.');await client.cancelQueries({queryKey:['transcript',reviewId]});for(const key of ['transcript','threads','speakers','coaching'])void client.invalidateQueries({queryKey:[key,reviewId]});},onError:()=>{void client.invalidateQueries({queryKey:['transcript',reviewId]});}});
 const load=useMutation({mutationFn:async()=>{const key=['transcript',reviewId];await client.cancelQueries({queryKey:key});const fresh=await api<{id:string;revision:number;transcript:Transcript}>(`/api/reviews/${reviewId}/transcript`),cached=client.getQueryData<typeof fresh>(key),latest=cached&&cached.revision>fresh.revision?cached:fresh;const passage=latest.transcript.utterances.find(u=>u.id===utterance.id);if(!passage)throw new Error('Passage is no longer available. Your draft is preserved.');client.setQueryData(key,latest);return {latest,passage};},onSuccess:({latest,passage})=>{setBase({id:latest.id,revision:latest.revision});setText(passage.text);setRecordingOnly(false);setMessage('');save.reset();}});
 return <details><summary className="cursor-pointer">Correct this passage</summary><form className="space-y-2" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending||load.isPending} className="space-y-2">
 <p>Use this only for words heard in the recording. Put new achievements or details in “Target role and optional background.” Saving does not start paid analysis.</p>
 <label className="block">Corrected wording<Textarea required maxLength={50000} value={text} onChange={e=>{setText(e.target.value);setMessage('');}}/></label>
 <label className="flex gap-2"><input type="checkbox" checked={recordingOnly} onChange={e=>setRecordingOnly(e.target.checked)}/>This wording reflects the recording, without adding new information.</label>
 <p className="text-sm">Audio covers {utterance.startMs/1000}–{utterance.endMs/1000} seconds. Corrections retain this enclosing passage; individual words are not timed.</p>
 {conflict&&<p role="alert">A newer transcript version is available. Your draft is preserved.</p>}
 {(conflict||save.isError)&&<Button type="button" variant="outline" onClick={()=>load.mutate()}>Load latest passage</Button>}
 <Button type="submit" disabled={!recordingOnly||!text.trim()||conflict}>{save.isPending?'Saving…':'Save correction'}</Button></fieldset>{save.error&&<p role="alert">{save.error.message}</p>}{load.error&&<p role="alert">{load.error.message}</p>}{message&&<p role="status">{message}</p>}</form></details>;
}
export function RefreshCorrectedAnalysis({reviewId,transcriptId}:{reviewId:string;transcriptId:string}) {
 const client=useQueryClient();const refresh=useMutation({mutationFn:()=>api(`/api/reviews/${reviewId}/transcript`,{method:'POST',body:JSON.stringify({actionId:crypto.randomUUID(),transcriptId})}),onSuccess:()=>{for(const key of ['threads','speakers','coaching'])void client.invalidateQueries({queryKey:[key,reviewId]});}});
 return <div><p>Corrected transcript. Earlier advice may be outdated. Refresh reuses prepared audio, transcription, and valid analysis; only necessary provider calls use the processing allowance.</p><Button onClick={()=>refresh.mutate()} disabled={refresh.isPending}>Refresh analysis</Button>{refresh.isSuccess&&<p role="status">Refresh requested. You can leave and return.</p>}{refresh.error&&<p role="alert">{refresh.error.message}</p>}</div>;
}
