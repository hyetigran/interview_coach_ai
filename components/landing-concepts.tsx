'use client';

import { useState, type Ref } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, CornerDownRight, Repeat2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { questions } from '@/lib/sample-interview';
import styles from './landing-concepts.module.css';

export type LandingConcept = '1' | '2' | '3';

const concepts = [
  { id: '1', name: 'Replay' },
  { id: '2', name: 'Notes' },
  { id: '3', name: 'Next round' },
] as const;

type ActionProps = { onOpenReview: () => void };
type ReviewProps = ActionProps & { revisions: string[] };

export function LandingConcepts({ concept, mainRef, revisions, onOpenReview }: ReviewProps & {
  concept: LandingConcept;
  mainRef: Ref<HTMLElement>;
}) {
  return <div className={styles.studies}>
    <header className={styles.studyBar}>
      <div className={styles.studyLabel}>Landing studies <span>Low fidelity</span></div>
      <nav aria-label="Landing page concepts" className={styles.conceptNav}>
        {concepts.map(item => <Link
          key={item.id}
          href={`/concepts/${item.id}`}
          aria-current={concept === item.id ? 'page' : undefined}
          className={styles.conceptLink}
        ><span>0{item.id}</span>{item.name}</Link>)}
      </nav>
    </header>
    <main id="main-content" ref={mainRef} tabIndex={-1} aria-labelledby="page-title" className={styles.main}>
      {concept === '1' && <ReplayConcept revisions={revisions} onOpenReview={onOpenReview} />}
      {concept === '2' && <NotesConcept revisions={revisions} onOpenReview={onOpenReview} />}
      {concept === '3' && <NextRoundConcept onOpenReview={onOpenReview} />}
    </main>
  </div>;
}

function ReviewAction({ onOpenReview }: ActionProps) {
  return <Button size="lg" className={styles.cta} onClick={onOpenReview}>
    Open sample review <ArrowRight aria-hidden="true" className="size-5" />
  </Button>;
}

function ReplayConcept({ revisions, onOpenReview }: ReviewProps) {
  const [moment, setMoment] = useState(1);
  const question = questions[moment];
  const times = ['00:42', '02:16', '04:08'];
  return <section className={styles.replay}>
    <div className={styles.replayHeading}>
      <p className={styles.eyebrow}>Game tape for your interviews</p>
      <h1 id="page-title">Watch it back.<br /><span>Go in better.</span></h1>
      <ReviewAction onOpenReview={onOpenReview} />
    </div>
    <Card className={styles.replayDesk}>
      <div className={styles.deskBar}><span>Interview / 01</span><span>Sample recording <span aria-hidden="true">↗</span></span></div>
      <div className={styles.replayBody}>
        <div className={styles.recording} aria-label="Recording wireframe">
          <div className={styles.cameraCorner} aria-hidden="true" />
          <div className={styles.person} aria-hidden="true"><div className={styles.personHead} /><div className={styles.personBody} /><div className={styles.laptop} /></div>
          <span className={styles.timecode}>{times[moment]} / 12:40</span>
          <span className={styles.recordingLabel}>Your interview</span>
        </div>
        <div className={styles.replayNote} aria-live="polite" aria-atomic="true">
          <p className={styles.eyebrow}>Moment 0{moment + 1} / {question.category}</p>
          <h2>{question.title}</h2>
          <p className={styles.originalQuote}>“{question.original}”</p>
          <div className={styles.coachNote}><CornerDownRight size={18} strokeWidth={1.5} aria-hidden="true" /><p>{question.why}</p></div>
          <details className={styles.nextTake}><summary>See the next take</summary><p>{revisions[moment]}</p></details>
        </div>
      </div>
      <div className={styles.momentStrip}>
        <div className={styles.waveform} data-moment={moment} aria-hidden="true">{Array.from({ length: 64 }, (_, i) => <span key={i} style={{ height: `${7 + ((i * 17 + i * i) % 29)}px` }} />)}</div>
        <div className={styles.momentButtons} role="group" aria-label="Interview moments">
          {['Introduction', 'Collaboration', 'Trade-off'].map((label, i) => <Button
            key={label} variant="ghost" aria-pressed={moment === i} className={styles.momentButton} onClick={() => setMoment(i)}
          ><span className={styles.momentDot} aria-hidden="true" /><span>{times[i]}</span>{label}</Button>)}
        </div>
      </div>
    </Card>
    <p className={styles.replayFooter}><span>Replay.</span><span>Find the moment.</span><span>Try it again.</span></p>
  </section>;
}

function NotesConcept({ revisions, onOpenReview }: ReviewProps) {
  const [take, setTake] = useState('original');
  return <section className={styles.notes}>
    <div className={styles.notesCopy}>
      <p className={styles.eyebrow}>A second look at your answers</p>
      <h1 id="page-title">Good answers<br />are <span>edited.</span></h1>
      <p className={styles.subtitle}>Your words. A clearer next take.</p>
      <ReviewAction onOpenReview={onOpenReview} />
      <div className={styles.editorialFootnote}><span aria-hidden="true">↳</span><p>Keep the experience.<br />Improve how you tell it.</p></div>
    </div>
    <div className={styles.paperStack}>
      <div className={styles.paperBehind} aria-hidden="true" />
      <Card className={styles.paper}>
        <Tabs value={take} onValueChange={value => setTake(String(value))} className={styles.paperTabs}>
          <div className={styles.paperHeader}>
            <p className={styles.eyebrow}>Interview notes / 02</p>
            <TabsList variant="line" aria-label="Answer version" className={styles.takeTabs}>
              <TabsTrigger value="original">Original</TabsTrigger>
              <TabsTrigger value="revised">Next take</TabsTrigger>
            </TabsList>
          </div>
          <h2>{questions[1].title}</h2>
          <TabsContent value="original" className={styles.paperContent}>
            <blockquote><span className={styles.quietSentence}>We had different opinions.</span> I put both options into a <mark>prototype</mark> and walked the team through them. Then we agreed on a plan.</blockquote>
            <div className={styles.marginNote}><ArrowDown size={26} strokeWidth={1.5} aria-hidden="true" /><p>Lead with what you did.</p></div>
          </TabsContent>
          <TabsContent value="revised" className={styles.paperContent}>
            <blockquote>{revisions[1]}</blockquote>
            <div className={styles.marginNote}><Check size={24} strokeWidth={1.5} aria-hidden="true" /><p>Your contribution is clearer.</p></div>
          </TabsContent>
          <div className={styles.paperFooter}><span>Same experience. Better telling.</span><span>02 / 06</span></div>
        </Tabs>
      </Card>
    </div>
    <div className={styles.notesBottom}><span>Game tape for your interviews.</span><span>Read it. Mark it. Refine it.</span></div>
  </section>;
}

const practiceItems = [
  { title: 'Make your contribution specific.', detail: 'Start with what you did.', tag: 'Collaboration' },
  { title: 'Explain the trade-off.', detail: 'Connect your decision to the problem.', tag: 'Decision making' },
  { title: 'Give one concrete example.', detail: 'Use an experience you can support.', tag: 'Self-awareness' },
];

function NextRoundConcept({ onOpenReview }: ActionProps) {
  const [ready, setReady] = useState<number[]>([]);
  return <section className={styles.nextRound}>
    <div className={styles.roundTop}><span>From the last interview</span><ArrowRight size={20} strokeWidth={1.5} aria-hidden="true" /><span>To the next</span></div>
    <div className={styles.roundHero}>
      <div className={styles.roundCopy}>
        <p className={styles.eyebrow}>Review with a next step</p>
        <h1 id="page-title">Make the next<br />interview <span>count.</span></h1>
        <p className={styles.subtitle}>Turn your last interview into a short practice plan.</p>
        <ReviewAction onOpenReview={onOpenReview} />
      </div>
      <div className={styles.planArea}>
        <div className={styles.planConnector} aria-hidden="true"><Repeat2 size={38} strokeWidth={1} /></div>
        <Card className={styles.plan}>
          <div className={styles.planHeader}><p className={styles.eyebrow}>For your next interview</p><span className={styles.planProgress} aria-live="polite">{ready.length} / 3</span></div>
          <h2>Three things to practise.</h2>
          <div className={styles.practiceList}>
            {practiceItems.map((item, index) => <label key={item.title} className={styles.practiceItem}>
              <input type="checkbox" aria-label={item.title} checked={ready.includes(index)} onChange={event => {
                const checked = event.target.checked;
                setReady(current => checked ? [...current, index] : current.filter(i => i !== index));
              }} />
              <span className={styles.checkBox} aria-hidden="true"><Check size={15} strokeWidth={2} /></span>
              <span><span className={styles.practiceTitle}>{item.title}</span><span className={styles.practiceDetail}>{item.detail}</span><span className={styles.practiceTag}>{item.tag}</span></span>
            </label>)}
          </div>
          <div className={styles.planFooter}>A little more prepared each time.<span aria-hidden="true">↗</span></div>
        </Card>
      </div>
    </div>
    <ol className={styles.roundSteps} aria-label="How it works">
      <li><span>01</span><h2>Replay</h2><p>See what you said.</p></li>
      <li><span>02</span><h2>Refine</h2><p>Find a clearer answer.</p></li>
      <li><span>03</span><h2>Prepare</h2><p>Take it into the next one.</p></li>
    </ol>
  </section>;
}
