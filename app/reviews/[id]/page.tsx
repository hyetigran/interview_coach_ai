import { ReviewWorkspace } from '@/components/review-workspace';
export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="mx-auto w-full max-w-6xl px-6"><ReviewWorkspace reviewId={id} /></main>;
}
