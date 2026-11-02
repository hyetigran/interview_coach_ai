'use client';

import { useEffect, useId, useRef } from 'react';
import { AnswerReview } from '@/components/answer-review';
import { questions } from '@/lib/sample-interview';
import styles from './interview-review-preview.module.css';

export function InterviewReviewPreview({ revisions }: { revisions: readonly string[] }) {
  const id = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const cycleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const cycle = cycleRef.current;
    if (!viewport || !cycle) return;

    const updateDuration = () => {
      const seconds = Math.max(cycle.getBoundingClientRect().height / 28, 1);
      viewport.style.setProperty('--review-duration', `${seconds}s`);
    };
    updateDuration();
    const resizeObserver = new ResizeObserver(updateDuration);
    resizeObserver.observe(cycle);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      viewport.dataset.visible = String(entry.isIntersecting);
    });
    visibilityObserver.observe(viewport);
    return () => {
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, []);

  return <div
    ref={viewportRef}
    role="region"
    aria-label="Interview answer preview"
    className={`relative h-95 overflow-hidden rounded-2xl bg-background/95 px-5 shadow-sm ring-1 ring-border ${styles.viewport}`}
  >
    <div className={styles.track}>
      {[0, 1].map(copy => <div key={copy} ref={copy === 0 ? cycleRef : undefined} aria-hidden={copy === 1 ? true : undefined} className="space-y-6 py-5">
          {questions.map((question, index) => <article key={question.short} className="@container min-w-0" aria-labelledby={`${id}-${copy}-question-${index}`}>
            <p className="text-sm text-muted-foreground">Question {index + 1} of {questions.length} · {question.category}</p>
            <h2 id={`${id}-${copy}-question-${index}`} className="mt-3 text-2xl leading-snug font-medium tracking-tight">{question.title}</h2>
            <div className="mt-5"><AnswerReview original={question.original} revised={revisions[index]} why={question.why} /></div>
          </article>)}
      </div>)}
    </div>
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-linear-to-b from-background to-transparent" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-background to-transparent" />
  </div>;
}
