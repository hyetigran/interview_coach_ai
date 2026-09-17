'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
type Status = { state: string; error: string | null; result: { durationMs: number; channels: number; sampleRate: number } | null } | null;
export function PreparationStatus({ reviewId }: { reviewId: string }) {
  const query = useQuery({ queryKey: ['preparation', reviewId], queryFn: () => api<Status>(`/api/reviews/${reviewId}/processing`), refetchInterval: query => !query.state.data || ['queued', 'running'].includes(query.state.data.state) ? 1500 : false });
  if (query.error) return <p role="alert" className="mt-3">Unable to load preparation status. Reload to retry.</p>;
  const job = query.data;
  if (job?.state === 'ready') return <div className="mt-3"><p role="status">Recording prepared</p><p className="text-sm text-muted-foreground">{Math.round((job.result?.durationMs ?? 0) / 1000)} seconds of verified audio. Transcription is coming in the next update.</p></div>;
  if (job?.state === 'failed') return <p role="alert" className="mt-3">{job.error}</p>;
  if (job?.state === 'cancelled') return <p role="status" className="mt-3">Preparation cancelled.</p>;
  return <p role="status" className="mt-3">{job?.state === 'running' ? 'Preparing your recording…' : 'Recording saved. Waiting for preparation…'} You can leave this page and return later.</p>;
}
