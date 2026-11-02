import { notFound } from 'next/navigation';
import { InterviewCoach } from '@/components/interview-coach';

export const dynamicParams = false;

export function generateStaticParams() {
  return ['1', '2', '3', 'previous'].map(concept => ({ concept }));
}

export default async function ConceptPage({ params }: { params: Promise<{ concept: string }> }) {
  const { concept } = await params;
  if (concept === 'previous') return <InterviewCoach landingVersion="portrait" />;
  if (concept !== '1' && concept !== '2' && concept !== '3') notFound();
  return <InterviewCoach key={concept} landingConcept={concept} />;
}
