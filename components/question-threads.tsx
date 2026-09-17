'use client';
import {GroupingCorrection} from './grouping-correction';
import { CoachingCard } from './coaching-card';
import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Evidence, QuestionGroup } from '@/lib/threads';
import { Button } from './ui/button';
type State = {retry?:{runId:string;version:number;canRetry:boolean;reason:string;maximumUnits:number;sections:number[]}|null;id?:string;transcriptId?:string;version?:number;previous?:{groups:QuestionGroup[];advice:{threadId:string;result:import('@/lib/coaching').CoachingResult}[]}|null;state:string;total:number;completed:number;errors:{section:number;error:string|null}[];groups:QuestionGroup[]} | null;
export function QuestionThreads({reviewId}:{reviewId:string}) {
  const client=useQueryClient(),retryAction=useRef<{target:string;id:string}|null>(null);
  const retry=useMutation({mutationFn:(plan:NonNullable<NonNullable<State>['retry']>)=>{
    const target=plan.runId+':'+plan.version;if(retryAction.current?.target!==target)retryAction.current={target,id:crypto.randomUUID()};
    return api(`/api/reviews/${reviewId}/threads`,{method:'POST',body:JSON.stringify({actionId:retryAction.current.id,runId:plan.runId,version:plan.version})});
  },onSettled:async()=>{await client.invalidateQueries({queryKey:['threads',reviewId]});await client.invalidateQueries({queryKey:['coaching',reviewId]});}});
  const audio=useRef<HTMLAudioElement>(null);
  const query=useQuery({queryKey:['threads',reviewId],queryFn:()=>api<State>(`/api/reviews/${reviewId}/threads`),refetchInterval:q=>!q.state.data||q.state.data.state==='running'?3000:false});
  if(query.error&&!query.data)return <p role="alert">Unable to load question threads. Reload to retry.</p>;
  if(!query.data)return null;
  const {state,total,completed,groups,errors,previous}=query.data;
  function evidence(items:Evidence[]) {return <ul className="space-y-2">{items.map(item=><li key={`${item.utteranceId}:${item.start}:${item.end}`}>
    <blockquote className="whitespace-pre-wrap">{item.quote}</blockquote>
    <Button variant="ghost" onClick={()=>{if(audio.current){audio.current.currentTime=item.startMs/1000;void audio.current.play().catch(()=>{});}}}>Play passage at {Math.floor(item.startMs/60000)}:{String(Math.floor(item.startMs/1000)%60).padStart(2,'0')}</Button>
    {item.uncertain&&<p className="text-sm">Uncertain speaker or overlapping speech — check the recording.</p>}
  </li>)}</ul>;}
  function thread(group:QuestionGroup):React.ReactNode {return <li key={group.id} className="rounded-md border p-3"><details>
    <summary className="cursor-pointer font-medium">{group.question.map(q=>q.quote).join(' ')}</summary>
    <div className="mt-3 space-y-3">
      {group.uncertain&&<p role="note">This association is uncertain. Compare it with the transcript and audio.</p>}
      <h4 className="font-medium">Question evidence</h4>{evidence(group.question)}
      <h4 className="font-medium">Original answer</h4>{group.answers.length?evidence(group.answers):<p>No supported answer was linked to this question.</p>}
      {!group.parentId&&!['needs_review','corrected'].includes(state)&&<CoachingCard reviewId={reviewId} threadId={group.id} />}
    </div>
  </details>{groups.some(g=>g.parentId===group.id)&&<div className="mt-3 pl-3"><h4>Follow-ups</h4><ol className="space-y-2">{groups.filter(g=>g.parentId===group.id).map(g=>thread(g))}</ol></div>}</li>;}
  return <section className="space-y-3" aria-labelledby="questions-heading"><h3 id="questions-heading" className="font-semibold">Question threads</h3>
    <GroupingCorrection reviewId={reviewId} current={query.data.id&&query.data.transcriptId&&typeof query.data.version==='number'?{id:query.data.id,transcriptId:query.data.transcriptId,version:query.data.version,groups}:null}/>
    {query.error&&<p role="alert">Unable to refresh question groups. Open drafts are preserved.</p>}
    {state==='needs_review'&&<p role="alert">Recorded evidence changed within your saved grouping. Earlier passages remain below for comparison. Open “Correct question groups,” check each selected passage against the recording, and save before refreshing analysis.</p>}
    {state==='corrected'&&<p role="status">Your saved question grouping is retained. Refresh analysis when ready.</p>}
    {state==='running'&&<p role="status">Grouping questions: {completed} of {total} sections ready. You can leave and return later.</p>}
    {state==='partial'&&<p role="status">Some sections could not be grouped. Available threads and the full transcript remain accessible.</p>}
    {state==='partial'&&query.data.retry&&<div className="space-y-2"><p>{query.data.retry.reason}</p>{query.data.retry.canRetry&&<><p>This retry reserves up to ${(query.data.retry.maximumUnits/1000000).toFixed(2)} for {query.data.retry.sections.length} sections. Unused reservations are released when a saved result can be reused.</p><Button disabled={retry.isPending} onClick={()=>retry.mutate(query.data!.retry!)}>{retry.isPending?'Queuing retry…':'Retry question grouping'}</Button></>}{retry.error&&<p role="alert">{retry.error.message}</p>}</div>}
    {state==='running'&&query.data.retry&&<p>Earlier section results remain visible while their dependencies are rechecked. Earlier coaching may be outdated.</p>}
    {errors.map(error=><p key={error.section}>Section {error.section}: {error.error}</p>)}
    <p className="text-sm text-muted-foreground">Automatic groupings can be wrong. Playback starts at the source passage; word-level timing is unavailable. Logistics and candidate questions remain in the full transcript.</p>
    <audio ref={audio} controls preload="none" src={`/api/reviews/${reviewId}/audio`} aria-label="Question evidence playback" />
    {!groups.length&&!['running','outdated'].includes(state)&&<p>No supported interview questions were found in the completed sections.</p>}
    <ol className="space-y-3">{groups.filter(g=>!g.parentId).map(g=>thread(g))}</ol>
    {state==='outdated'&&<p role="status">Transcript evidence changed. Refresh analysis to update affected question threads and coaching.</p>}
    {previous&&<details><summary className="cursor-pointer">Earlier question threads and advice</summary><p>This snapshot precedes your correction. It remains readable as historical evidence and may be outdated.</p>
      {previous.groups.map(group=><section key={group.id} className="my-3 space-y-2 border p-3"><h4>{group.question.map(q=>q.quote).join(' ')}</h4>{evidence(group.answers)}{previous.advice.filter(a=>a.threadId===group.id).map(advice=><div key={advice.threadId}><p>{advice.result.rationale}</p><p className="whitespace-pre-wrap">{advice.result.segments.map(s=>s.text).join(' ')}</p></div>)}</section>)}
    </details>}

  </section>;
}
