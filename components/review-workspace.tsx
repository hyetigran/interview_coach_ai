'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, RequestError } from '@/lib/api';
import type { Review, ReviewPage } from '@/lib/reviews/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AudioUpload } from '@/components/audio-upload';

type Candidate = { id: string; name: string; email: string };
export function ReviewWorkspace({ reviewId }: { reviewId?: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState('');
  const [deletionPending, setDeletionPending] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Candidate>('/api/me'), retry: false });
  const ownerId = me.data?.id;
  useEffect(() => { if (me.error instanceof RequestError && me.error.status === 401) { client.clear(); router.replace('/sign-in'); } }, [me.error, router, client]);
  const list = useInfiniteQuery({
    queryKey: ['reviews', ownerId], initialPageParam: '',
    queryFn: ({ pageParam }) => api<ReviewPage>(`/api/reviews${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(ownerId) && !reviewId,
  });
  const listedReviews = list.data?.pages.flatMap(page => page.items);
  const detail = useQuery({ queryKey: ['review', ownerId, reviewId], queryFn: () => api<Review>(`/api/reviews/${reviewId}`), enabled: Boolean(ownerId && reviewId) });
  const create = useMutation({
    mutationFn: (form: FormData) => api<Review>('/api/reviews', { method: 'POST', body: JSON.stringify({ title: form.get('title'), role: form.get('role'), origin: form.get('origin') }) }),
    onSuccess: review => { client.invalidateQueries({ queryKey: ['reviews', ownerId] }); router.push(`/reviews/${review.id}`); },
  });
  const remove = useMutation({
    mutationFn: () => api<{ cleanupPending: boolean } | undefined>(`/api/reviews/${reviewId}`, { method: 'DELETE' }),
    onSuccess: result => { if (result?.cleanupPending) { setDeletionPending(true); client.invalidateQueries({ queryKey: ['review', ownerId, reviewId] }); return; } client.removeQueries({ queryKey: ['review', ownerId, reviewId] }); client.invalidateQueries({ queryKey: ['reviews', ownerId] }); router.replace('/reviews'); },
  });
  const deletion = useQuery({ queryKey: ['deletion', ownerId, reviewId], queryFn: () => api<{ cleanupPending: boolean }>(`/api/reviews/${reviewId}/deletion`), enabled: Boolean(ownerId && reviewId && (deletionPending || (detail.error instanceof RequestError && detail.error.status === 404))), refetchInterval: query => query.state.data?.cleanupPending ? 5000 : false });
  async function signOut() {
    try { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); client.clear(); router.replace('/sign-in'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign out.'); }
  }
  if (me.isPending) return <p role="status" className="py-16">Opening your workspace…</p>;
  if (!me.data) return <div className="py-16"><p role="alert">{me.error?.message ?? 'Sign in to continue.'}</p><Link href="/sign-in" className="underline">Back to sign in</Link></div>;
  return <>
    <header className="flex flex-wrap items-center justify-between gap-4 border-b py-6"><Link href="/reviews" className="font-medium">Interview Coach</Link><div className="flex items-center gap-4"><span className="text-sm text-muted-foreground">{me.data.name}</span><Button variant="outline" onClick={signOut}>Sign out</Button></div></header>
    {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
    {reviewId ? <section className="py-12">
      <Link href="/reviews" className="text-sm underline">All reviews</Link>
      {detail.isPending && <p role="status" className="mt-6">Loading review…</p>}
      {detail.error && <p role="alert" className="mt-6">{detail.error.message}</p>}
      {deletion.data?.cleanupPending && <div className="mt-4"><p role="status">Access is blocked. Recording cleanup is still pending and will retry automatically.</p><Button onClick={() => remove.mutate()} disabled={remove.isPending}>Retry cleanup</Button></div>}
      {detail.data && !deletionPending && <><h1 className="mt-6 text-3xl font-medium">{detail.data.title}</h1><p className="mt-3 text-muted-foreground">{detail.data.role} · {detail.data.origin === 'hiring' ? 'Hiring interview' : 'Mock interview'}</p><AudioUpload reviewId={reviewId} ownerId={me.data.id} /><Button variant="destructive" disabled={remove.isPending} onClick={() => { if (window.confirm('Delete this review? This cannot be undone.')) remove.mutate(); }}>{remove.isPending ? 'Deleting…' : 'Delete review'}</Button>{remove.error && <p role="alert" className="mt-3 text-destructive">{remove.error.message}</p>}</>}
    </section> : <div className="grid gap-12 py-12 md:grid-cols-2">
      <section><h1 className="text-3xl font-medium">Your reviews</h1><p className="mt-3 text-sm text-muted-foreground">A private place to reflect on past interviews.</p>
        {list.isPending && <p role="status" className="mt-6">Loading reviews…</p>}
        {list.error && <p role="alert" className="mt-6">{list.error.message}</p>}
        {listedReviews?.length === 0 && <p className="mt-8 rounded-xl border p-6 text-sm">No reviews yet. Create your first review to get started.</p>}
        <ul className="mt-6 space-y-3">{listedReviews?.map(review => <li key={review.id}><Link href={`/reviews/${review.id}`} className="block rounded-xl border p-5 hover:bg-muted focus-visible:ring-2"><h2 className="font-medium">{review.title}</h2><p className="mt-2 text-sm text-muted-foreground">{review.role} · {review.origin === 'hiring' ? 'Hiring interview' : 'Mock interview'}</p></Link></li>)}</ul>
        {list.hasNextPage && <Button className="mt-4" variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? 'Loading…' : 'Load more reviews'}</Button>}
      </section>
      <section className="rounded-xl border p-6"><h2 className="text-xl font-medium">Create a review</h2><form className="mt-6 space-y-5" onSubmit={event => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
        <div className="space-y-2"><Label htmlFor="title">Review title</Label><Input id="title" name="title" required maxLength={120} placeholder="Hiring manager conversation" /></div>
        <div className="space-y-2"><Label htmlFor="role">Target role</Label><Input id="role" name="role" required maxLength={120} placeholder="Software engineer" /></div>
        <div className="space-y-2"><Label htmlFor="origin">Interview type</Label><select id="origin" name="origin" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="hiring">Hiring interview</option><option value="mock">Mock interview</option></select></div>
        {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create review'}</Button>
      </form></section>
    </div>}
  </>;
}
