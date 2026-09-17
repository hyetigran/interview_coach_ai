'use client';
import { TranscriptView } from './transcript-view';
import {useRef} from 'react';
import {Button} from './ui/button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
type Status = { id:string;retry?:{attempt:number;canRetry:boolean;waiting:boolean;reason:string}; state: string; error: string | null; result: { durationMs: number; channels: number; sampleRate: number } | null } | null;
export function PreparationStatus({ reviewId }: { reviewId: string }) {
  const client=useQueryClient(),action=useRef<{target:string;id:string}|null>(null);
  const retry=useMutation({mutationFn:(job:NonNullable<Status>)=>{
    const target=job.id+':'+job.retry!.attempt;if(action.current?.target!==target)action.current={target,id:crypto.randomUUID()};
    return api(`/api/reviews/${reviewId}/processing`,{method:'POST',body:JSON.stringify({actionId:action.current.id,jobId:job.id,attempt:job.retry!.attempt})});
  },onSettled:()=>client.invalidateQueries({queryKey:['preparation',reviewId]})});
  const query = useQuery({ queryKey: ['preparation', reviewId], queryFn: () => api<Status>(`/api/reviews/${reviewId}/processing`), refetchInterval: query => !query.state.data || query.state.data.retry?.waiting || ['queued', 'running'].includes(query.state.data.state) ? 1500 : false });
  if (query.error) return <p role="alert" className="mt-3">Unable to load preparation status. Reload to retry.</p>;
  const job = query.data;
  if (job?.state === 'ready') return <div className="mt-3"><p role="status">Recording prepared</p><audio controls preload="metadata" src={`/api/reviews/${reviewId}/audio`} aria-label="Private interview recording" /><p className="text-sm text-muted-foreground">{Math.round((job.result?.durationMs ?? 0) / 1000)} seconds of verified audio. </p><TranscriptView reviewId={reviewId} /></div>;
  if (job?.state === 'failed') return <div className="mt-3 space-y-3"><p role="alert">{job.error}</p><p>{job.retry?.reason}</p>{job.retry?.canRetry&&<Button disabled={retry.isPending} onClick={()=>retry.mutate(job)}>{retry.isPending?'Queuing retry…':'Retry preparation'}</Button>}{retry.error&&<p role="alert">{retry.error.message}</p>}</div>;
  if (job?.state === 'cancelled') return <p role="status" className="mt-3">Preparation cancelled.</p>;
  return <p role="status" className="mt-3">{job?.state === 'running' ? 'Preparing your recording…' : 'Recording saved. Waiting for preparation…'} You can leave this page and return later.</p>;
}
