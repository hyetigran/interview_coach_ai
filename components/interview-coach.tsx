'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import confidencePortrait from '@/public/interview-confidence-laptop.png';
import { ArrowLeft, ArrowRight, Bookmark, Check, FileText, ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Toaster } from '@/components/ui/sonner';
import { questions } from '@/lib/sample-interview';
import { AnswerReview } from '@/components/answer-review';
import { InterviewReviewPreview } from '@/components/interview-review-preview';
import { LandingConcepts, type LandingConcept } from '@/components/landing-concepts';
import { ReplayLanding } from '@/components/replay-landing';
import { cn } from '@/lib/utils';

type Screen = 'landing' | 'workspace';
type Section = 'review' | 'saved' | 'priorities';
type Modal = 'import' | 'edit' | null;
const questionOptions = questions.map((question, index) => ({
  value: String(index),
  label: `${index + 1}. ${question.short}`,
}));

export function InterviewCoach({ landingConcept, landingVersion = 'replay' }: {
  landingConcept?: LandingConcept;
  landingVersion?: 'replay' | 'portrait';
} = {}) {
  const [screen, setScreen] = useState<Screen>('landing');
  const [section, setSection] = useState<Section>('review');
  const [selected, setSelected] = useState(1);
  const [detailTab, setDetailTab] = useState('answer');
  const [modal, setModal] = useState<Modal>(null);
  const [revisions, setRevisions] = useState(questions.map(q => q.revised));
  const [saved, setSaved] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const [priorities, setPriorities] = useState([
    'Make your own contribution specific.',
    'Explain the reasoning behind your decision.',
    '',
  ]);
  const mainRef = useRef<HTMLElement>(null);
  const revisionRef = useRef<HTMLTextAreaElement>(null);
  const moveFocus = useRef(false);
  const q = questions[selected];

  useEffect(() => {
    if (moveFocus.current) {
      mainRef.current?.focus({ preventScroll: true });
      moveFocus.current = false;
    }
  }, [screen, section]);

  function navigate(next: Screen) {
    moveFocus.current = true;
    setScreen(next);
    window.scrollTo({ top: 0 });
  }

  function openSection(next: Section) {
    moveFocus.current = true;
    setSection(next);
    window.scrollTo({ top: 0 });
  }

  function openReview(questionIndex: number) {
    setSelected(questionIndex);
    setSection('review');
    setDetailTab('answer');
    navigate('workspace');
  }

  function openExample() {
    openReview(1);
  }

  function saveAnswer() {
    setSaved(current => current.includes(selected) ? current : [...current, selected]);
    toast.success('Answer saved.');
  }

  function selectQuestion(index: number) {
    setSelected(index);
    setDetailTab('answer');
  }

  function editAnswer() {
    setDraft(revisions[selected]);
    setDraftError('');
    setModal('edit');
  }

  return <>
    <a href="#main-content" className="fixed -top-20 start-4 z-50 inline-flex h-11 items-center rounded-lg bg-background px-4 text-sm focus:top-4">Skip to content</a>

    {screen === 'landing' && landingConcept ? (
      <LandingConcepts concept={landingConcept} mainRef={mainRef} revisions={revisions} onOpenReview={openExample} />
    ) : screen === 'landing' && landingVersion === 'replay' ? (
      <ReplayLanding mainRef={mainRef} revisions={revisions} onOpenReview={openReview} />
    ) : screen === 'landing' ? (
      <main id="main-content" ref={mainRef} tabIndex={-1} aria-labelledby="page-title" className="bg-background outline-none">
        <section className="relative isolate overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[clamp(20rem,70vw,32rem)] min-[1200px]:inset-y-0 min-[1200px]:left-[38%] min-[1200px]:h-auto">
            <Image
              src={confidencePortrait}
              alt=""
              fill
              sizes="(max-width: 400px) 150vw, 100vw"
              loading="eager"
              className="object-cover object-[42%_top] select-none min-[1200px]:object-[35%_center]"
            />
            <div className="absolute inset-0 bg-linear-to-t from-background from-20% via-background/0 via-60% to-transparent min-[1200px]:hidden" />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-linear-to-r from-background from-25% via-background via-38% to-transparent to-58% min-[1200px]:block" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-background to-transparent" />
          <div className="relative mx-auto grid min-h-svh w-full max-w-[1280px] content-start items-start gap-7 px-6 py-8 pt-[clamp(16rem,40vw,20rem)] min-[600px]:px-12 min-[800px]:grid-cols-2 min-[800px]:gap-8 min-[1200px]:min-h-[max(100svh,45rem)] min-[1200px]:gap-16 min-[1200px]:px-16 min-[1200px]:pt-8 min-[1200px]:pb-6">
            <div className="w-full max-w-md">
              <h1 id="page-title" className="text-[clamp(2.5rem,4.5vw,3.5rem)] leading-[1.08] font-medium tracking-[-0.05em] text-balance"><span className="text-primary">Game tape</span> for your interviews.</h1>
              <p className="mt-5 max-w-sm text-base leading-6 text-muted-foreground">Review your answers and find what to improve.</p>
              <Button size="lg" className="mt-6 h-14 gap-4 px-7 text-base" onClick={openExample}>Open sample review<ArrowRight className="size-5" aria-hidden="true" /></Button>
            </div>
            <div className="ms-auto w-full max-w-[35rem] min-[800px]:max-w-none min-[1200px]:mt-[max(17rem,calc(43svh_-_2rem))]">
              <InterviewReviewPreview revisions={revisions} />
            </div>
          </div>
        </section>
      </main>
    ) : (
      <div className="grid min-h-svh min-w-0 grid-rows-[auto_1fr] lg:grid-cols-[208px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="flex flex-wrap items-center justify-between gap-3 border-b bg-sidebar px-4 py-3 lg:flex-col lg:items-stretch lg:justify-start lg:gap-8 lg:border-e lg:border-b-0 lg:p-5 lg:py-6">
          <Button variant="ghost" className="h-11 justify-start px-3 lg:self-start" onClick={() => navigate('landing')}><ArrowLeft aria-hidden="true" />Home</Button>
          <nav className="order-3 flex w-full gap-1 lg:order-none lg:flex-col lg:gap-2" aria-label="Workspace navigation">
            {([
              ['review', 'Review', FileText],
              ['saved', 'Saved answers', Bookmark],
              ['priorities', 'Priorities', ListChecks],
            ] as const).map(([value, label, Icon]) => (
              <Button key={value} variant="ghost" aria-label={value === 'saved' && saved.length > 0 ? `Saved answers ${saved.length}` : label} aria-current={section === value ? 'page' : undefined} className={cn('h-11 min-w-0 flex-1 gap-2 px-2 lg:flex-none lg:justify-start lg:px-3', section === value && 'bg-sidebar-accent')} onClick={() => openSection(value)}>
                <Icon className="hidden size-4 sm:block" aria-hidden="true" /><span className={value === 'saved' ? 'hidden sm:inline' : undefined}>{label}</span>{value === 'saved' && <span className="sm:hidden">Saved</span>}
                {section === value && <Check className="size-3.5" aria-hidden="true" />}
                {value === 'saved' && saved.length > 0 && <span className="text-xs tabular-nums text-muted-foreground lg:ms-auto">{saved.length}</span>}
              </Button>
            ))}
          </nav>
          <div className="lg:mt-auto">
            <Button variant="outline" className="h-11 gap-2 px-3 lg:w-full" onClick={() => setModal('import')}><Plus aria-hidden="true" />New review</Button>
            <p className="mt-4 hidden text-xs leading-5 text-muted-foreground lg:block">Sample workspace.<br />Changes reset on refresh.</p>
          </div>
        </aside>

        <main id="main-content" ref={mainRef} tabIndex={-1} aria-labelledby="page-title" className="min-w-0 outline-none">
          <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8 lg:py-10 xl:px-10">
            {section === 'review' ? <>
              <header className="mb-8">
                <h1 id="page-title" className="text-2xl font-medium tracking-tight">Product designer · Acme</h1>
                <p className="mt-2 text-sm text-muted-foreground">Sample hiring interview · {questions.length} questions</p>
              </header>

              <div className="grid gap-8 min-[1120px]:grid-cols-[184px_minmax(0,1fr)]">
                <aside className="min-w-0" aria-label="Interview questions">
                  <div className="space-y-2 min-[1120px]:hidden">
                    <Label htmlFor="question-select">Question</Label>
                    <Select value={String(selected)} items={questionOptions} onValueChange={value => { if (value !== null) selectQuestion(Number(value)); }}>
                      <SelectTrigger id="question-select" className="h-auto! min-h-11 w-full gap-3 px-3 py-2 text-base"><SelectValue /></SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {questionOptions.map(option => <SelectItem key={option.value} value={option.value} className="min-h-11 py-3 *:whitespace-normal">{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="hidden min-[1120px]:block">
                    <h2 className="mb-3 px-3 text-sm font-medium text-muted-foreground">Questions</h2>
                    <nav className="space-y-1" aria-label="Question navigation">
                      {questions.map((item, i) => (
                        <Button key={item.short} variant="ghost" aria-label={`Question ${i + 1}: ${item.short}`} aria-current={selected === i ? 'step' : undefined} className={cn('h-auto min-h-14 w-full items-start justify-start gap-3 px-3 py-3 text-start whitespace-normal', selected === i && 'bg-primary/5 ring-1 ring-inset ring-primary/20')} onClick={() => selectQuestion(i)}>
                          <span className="flex size-4 shrink-0 items-center justify-center pt-0.5 text-xs font-normal tabular-nums text-muted-foreground">{selected === i ? <Check className="size-4 text-foreground" aria-hidden="true" /> : String(i + 1).padStart(2, '0')}</span>
                          <span className="text-sm leading-5">{item.short}</span>
                        </Button>
                      ))}
                    </nav>
                  </div>
                </aside>

                <article className="@container min-w-0">
                  <p className="text-sm text-muted-foreground">Question {selected + 1} of {questions.length} · {q.category}</p>
                  <h2 className="mt-3 max-w-3xl text-2xl leading-snug font-medium tracking-tight md:text-[28px]">{q.title}</h2>
                  <Tabs value={detailTab} onValueChange={value => setDetailTab(String(value))} className="mt-5 gap-5">
                    <TabsList variant="line" aria-label="Answer details" className="h-11"><TabsTrigger value="answer" className="h-11 px-3">Answer</TabsTrigger><TabsTrigger value="source" className="h-11 px-3">Transcript</TabsTrigger></TabsList>
                    <TabsContent value="answer">
                      <AnswerReview original={q.original} revised={revisions[selected]} why={q.why} />
                      <div className="flex flex-wrap gap-3 pb-5">
                        <Button className="h-11 gap-2 px-4" disabled={saved.includes(selected)} focusableWhenDisabled onClick={saveAnswer}>{saved.includes(selected) ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}{saved.includes(selected) ? 'Saved' : 'Save answer'}</Button>
                        <Button variant="outline" className="h-11 px-4" onClick={editAnswer}>Edit answer</Button>
                      </div>
                      {selected === 1 && <Accordion><AccordionItem value="follow-up"><AccordionTrigger className="min-h-11">Follow-up question</AccordionTrigger><AccordionContent><FollowUp /></AccordionContent></AccordionItem></Accordion>}
                    </TabsContent>
                    <TabsContent value="source">
                      <Card className="[--card-spacing:--spacing(5)]">
                        <CardHeader><h3 className="text-sm font-medium text-muted-foreground">Original transcript</h3></CardHeader>
                        <CardContent className="space-y-5 text-base leading-7"><p><strong className="font-medium">Interviewer:</strong> {q.title}</p><p><strong className="font-medium">You:</strong> {q.original}</p>{selected === 1 && <FollowUp />}</CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </article>
              </div>
            </> : section === 'saved' ? (
              <section className="max-w-3xl">
                <h1 id="page-title" className="text-2xl font-medium tracking-tight">Saved answers</h1>
                <div className="mt-8 space-y-5">
                  {saved.length ? saved.map(i => <Card key={i} className="[--card-spacing:--spacing(5)]"><CardHeader><h2 className="text-lg font-medium leading-snug">{questions[i].title}</h2></CardHeader><CardContent><p className="text-base leading-7">{revisions[i]}</p><Button variant="ghost" className="mt-4 h-11 gap-2 px-0 hover:bg-transparent hover:text-primary" onClick={() => { selectQuestion(i); openSection('review'); }}>Open answer<ArrowRight aria-hidden="true" /></Button></CardContent></Card>) : <Card className="[--card-spacing:--spacing(6)]"><CardHeader><h2 className="text-lg font-medium">No saved answers</h2></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">Save a proposed answer from your review.</p><Button variant="outline" className="mt-5 h-11 px-4" onClick={() => openSection('review')}>Review answers</Button></CardContent></Card>}
                </div>
              </section>
            ) : (
              <section className="max-w-2xl">
                <h1 id="page-title" className="text-2xl font-medium tracking-tight">Preparation priorities</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose up to three things to practise.</p>
                <form className="mt-8 space-y-6" onSubmit={event => { event.preventDefault(); toast.success('Priorities saved.'); }}>
                  {priorities.map((value, i) => <div key={i} className="space-y-2"><Label htmlFor={`priority-${i}`}>Priority {i + 1}</Label><Textarea id={`priority-${i}`} className="min-h-11 resize-none text-base! leading-6" value={value} onChange={event => setPriorities(current => current.map((p, index) => index === i ? event.target.value : p))} /></div>)}
                  <Button type="submit" className="h-11 px-4">Save priorities</Button>
                </form>
              </section>
            )}
            <p className="mt-8 text-xs text-muted-foreground lg:hidden">Sample workspace. Changes reset on refresh.</p>
          </div>
        </main>
      </div>
    )}

    <Dialog open={modal !== null} onOpenChange={open => { if (!open) setModal(null); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {modal === 'import' ? <>
          <DialogHeader className="pe-10"><DialogTitle>New review</DialogTitle><DialogDescription>Recording uploads aren’t connected in this preview. You can explore the sample review.</DialogDescription></DialogHeader>
          <DialogFooter><Button className="h-11 gap-2 px-4" onClick={() => { setModal(null); openExample(); }}>Open sample review<ArrowRight aria-hidden="true" /></Button></DialogFooter>
        </> : <>
          <DialogHeader className="pe-10"><DialogTitle>Edit proposed answer</DialogTitle><DialogDescription>Your original transcript stays unchanged.</DialogDescription></DialogHeader>
          <form noValidate onSubmit={event => {
            event.preventDefault();
            if (!draft.trim()) { setDraftError('Enter an answer before saving.'); revisionRef.current?.focus(); return; }
            setRevisions(current => current.map((text, i) => i === selected ? draft.trim() : text));
            setSaved(current => current.includes(selected) ? current : [...current, selected]);
            setModal(null);
            toast.success('Answer updated.');
          }}>
            <div className="space-y-2 pb-6"><Label htmlFor="revision">Proposed answer</Label><Textarea id="revision" ref={revisionRef} className="min-h-48 text-base! leading-7" required aria-invalid={!!draftError} aria-describedby={draftError ? 'revision-error' : undefined} value={draft} onChange={event => { setDraft(event.target.value); setDraftError(''); }} />{draftError && <p id="revision-error" role="alert" className="text-sm text-destructive">{draftError}</p>}</div>
            <DialogFooter><Button type="button" variant="ghost" className="h-11 px-4" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" className="h-11 px-4">Save answer</Button></DialogFooter>
          </form>
        </>}
      </DialogContent>
    </Dialog>
    <Toaster theme="light" position="bottom-center" />
  </>;
}

function FollowUp() {
  return <div className="space-y-2 text-sm leading-7"><p><strong className="font-medium">Interviewer:</strong> What helped you reach an agreement?</p><p><strong className="font-medium">You:</strong> Seeing both options made it easier to talk about the differences.</p></div>;
}
