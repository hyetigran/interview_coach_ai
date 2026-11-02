'use client';

import { useState, type Ref } from 'react';
import Image from 'next/image';
import { ArrowRight, CornerDownRight } from 'lucide-react';
import confidencePortrait from '@/public/interview-confidence-laptop.png';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { questions } from '@/lib/sample-interview';
import styles from './replay-landing.module.css';

const moments = [
  { questionIndex: 0, label: 'Intro', time: '00:42' },
  { questionIndex: 1, label: 'Teamwork', time: '02:16' },
  { questionIndex: 2, label: 'Trade-off', time: '04:08' },
] as const;

const waveform = Array.from({ length: 26 }, (_, index) => 6 + ((index * 17 + index * index) % 25));

export function ReplayLanding({ mainRef, revisions, onOpenReview }: {
  mainRef: Ref<HTMLElement>;
  revisions: string[];
  onOpenReview: (questionIndex: number) => void;
}) {
  const [moment, setMoment] = useState(1);
  const [take, setTake] = useState('original');
  const activeMoment = moments[moment];
  const question = questions[activeMoment.questionIndex];
  const answerOptions = moments.flatMap(({ questionIndex }) => [
    questions[questionIndex].original,
    revisions[questionIndex],
  ]);

  function selectMoment(index: number) {
    setMoment(index);
    setTake('original');
  }

  return <main id="main-content" ref={mainRef} tabIndex={-1} aria-labelledby="page-title" className={styles.main}>
    <section className={styles.hero}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}><span aria-hidden="true" />Game tape for your interviews</p>
        <h1 id="page-title" className={styles.title}>Watch it back.<br /><span>Go in better.</span></h1>
        <Button size="lg" className={styles.primaryAction} onClick={() => onOpenReview(activeMoment.questionIndex)}>
          Open sample review<ArrowRight aria-hidden="true" className="size-5" strokeWidth={1.5} />
        </Button>
      </header>

      <Card className={styles.reviewFrame} role="region" aria-label="Sample interview review">
        <div className={styles.reviewBody}>
          <div className={styles.portrait}>
            <Image
              src={confidencePortrait}
              alt="A professional seated at a laptop."
              fill
              sizes="(max-width: 840px) calc(100vw - 40px), (max-width: 1120px) 45vw, 480px"
              loading="eager"
              placeholder="blur"
              className={styles.portraitImage}
            />
            <div className={styles.portraitFade} aria-hidden="true" />
            <div className={styles.timecode}><span>{activeMoment.time}</span><span>/ 12:40</span></div>
          </div>

          <article className={styles.review} aria-label={question.title}>
            <div className={styles.questionMeta}>
              <span>{question.category}</span>
              <span className={styles.questionNumber}>0{activeMoment.questionIndex + 1} / 06</span>
            </div>
            <div className={`${styles.contentStack} ${styles.questionHeading}`}>
              <h2 className={styles.questionTitle}>{question.title}</h2>
              {/* Invisible copies reserve the longest content at the current width. */}
              {moments.map(({ questionIndex }) => <p key={questionIndex} aria-hidden="true" className={`${styles.questionTitle} ${styles.sizingText}`}>
                {questions[questionIndex].title}
              </p>)}
            </div>

            <Tabs value={take} onValueChange={value => setTake(String(value))} className={styles.answerTabs}>
              <TabsList variant="line" aria-label="Answer version" className={styles.answerTabsList}>
                <TabsTrigger value="original" className={styles.answerTrigger}>Original</TabsTrigger>
                <TabsTrigger value="revised" className={styles.answerTrigger}>Next take</TabsTrigger>
              </TabsList>
              <div className={`${styles.contentStack} ${styles.answerContent}`}>
                <TabsContent value="original">
                  <p className={styles.answer}>{question.original}</p>
                </TabsContent>
                <TabsContent value="revised">
                  <p className={styles.answer}>{revisions[activeMoment.questionIndex]}</p>
                </TabsContent>
                {answerOptions.map((answer, index) => <p key={index} aria-hidden="true" className={`${styles.answer} ${styles.sizingText}`}>
                  {answer}
                </p>)}
              </div>
            </Tabs>

            <div className={styles.coachingNote}>
              <CornerDownRight size={18} strokeWidth={1.5} aria-hidden="true" />
              <div className={`${styles.contentStack} ${styles.coachingCopy}`}>
                <p>{question.why}</p>
                {moments.map(({ questionIndex }) => <p key={questionIndex} aria-hidden="true" className={styles.sizingText}>
                  {questions[questionIndex].why}
                </p>)}
              </div>
            </div>
          </article>
        </div>

        <div className={styles.timeline} role="group" aria-label="Interview moments">
          {moments.map((item, index) => <Button
            key={item.questionIndex}
            variant="ghost"
            aria-pressed={moment === index}
            aria-label={`${item.label} at ${item.time}`}
            className={styles.moment}
            onClick={() => selectMoment(index)}
          >
            <span className={styles.waveform} aria-hidden="true">
              {waveform.map((height, barIndex) => <span key={barIndex} style={{ height: `${height}px` }} />)}
            </span>
            <span className={styles.momentCaption}>
              <span className={styles.momentName}><span className={styles.momentDot} aria-hidden="true" />{item.label}</span>
              <span className={styles.momentTime}>{item.time}</span>
            </span>
          </Button>)}
        </div>
      </Card>
    </section>
  </main>;
}
