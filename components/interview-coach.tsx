'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronRight, CornerDownRight, FileText, Info, ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Toaster } from '@/components/ui/sonner';
import { questions } from '@/lib/sample-interview';
import { ExampleCarousel } from '@/components/example-carousel';
import { cn } from '@/lib/utils';

type Screen = 'landing' | 'workspace';
type Section = 'review' | 'saved' | 'priorities';
type Modal = 'import' | 'edit' | 'about' | null;
const eyebrow = 'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground';

export function InterviewCoach() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [section, setSection] = useState<Section>('review');
  const [selected, setSelected] = useState(1);
  const [detailTab, setDetailTab] = useState('answer');
  const [modal, setModal] = useState<Modal>(null);
  const [revisions, setRevisions] = useState(questions.map(q => q.revised));
  const [saved, setSaved] = useState<number[]>([]);
  const [draft, setDraft] = useState('');
  const [priorities, setPriorities] = useState(['Make your own contribution specific.', 'Explain the reasoning behind your decision.', '']);
  const q = questions[selected];

  function navigate(next: Screen) { setScreen(next); window.scrollTo({ top: 0 }); }
  function openExample() { setSelected(1); setSection('review'); setDetailTab('answer'); navigate('workspace'); }
  function saveAnswer() { setSaved(current => current.includes(selected) ? current : [...current, selected]); toast.success('Answer saved to your preparation collection.'); }
  function selectQuestion(index: number) { setSelected(index); setDetailTab('answer'); }
  function editAnswer() { setDraft(revisions[selected]); setModal('edit'); }

  return <>
    <header className="flex min-h-14 items-center justify-between gap-3 border-b bg-background px-4 sm:px-8">
      <span className="text-[10px] font-medium tracking-widest text-muted-foreground">DESIGN 02<span className="hidden sm:inline"> / INTERVIEW COACH</span></span>
      <Tabs value={screen} onValueChange={value => navigate(value as Screen)}>
        <TabsList aria-label="Preview screen"><TabsTrigger value="landing">Landing page</TabsTrigger><TabsTrigger value="workspace">Dashboard</TabsTrigger></TabsList>
      </Tabs>
      <span className="hidden text-[10px] tracking-widest text-muted-foreground lg:block">INTERACTIVE PROTOTYPE</span>
    </header>

    {screen === 'landing' ? <main className="bg-muted/25">
      <div className="mx-auto max-w-[1440px] px-6 md:px-14 lg:px-24">
        <nav className="flex items-center justify-end gap-4 py-7 md:justify-between" aria-label="Main navigation">
          <span className="hidden text-xs text-muted-foreground md:block">A little reflection. A clearer next answer.</span>
          <div className="flex items-center gap-3 sm:gap-6"><Button variant="ghost" onClick={openExample}>See an example</Button><Button variant="outline" onClick={() => navigate('workspace')}>Open workspace<ArrowUpRight data-icon="inline-end" /></Button></div>
        </nav>
        <section className="grid items-center gap-12 py-12 md:py-20 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <div>
            <p className={cn(eyebrow, 'flex items-center gap-2')}><span className="size-1.5 rounded-full bg-primary" />A closer look at your interview</p>
            <h1 className="mt-6 max-w-xl text-[clamp(2.7rem,4.7vw,4.4rem)] leading-[1.07] font-medium tracking-[-0.055em]">Find the answer<br className="hidden sm:block" /> inside <span className="text-primary">your answer.</span></h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground md:text-base">Look back at your interview. See what to clarify, what to keep, and how to tell your story next time.</p>
            <Button size="lg" className="mt-8 h-14 gap-3 px-7 text-base has-data-[icon=inline-end]:pr-6" onClick={() => setModal('import')}>Review my interview<ArrowUpRight className="size-5" data-icon="inline-end" /></Button>
            <p className="mt-4 text-xs text-muted-foreground">Start with a real or mock interview transcript.</p>
          </div>
          <ExampleCarousel />
        </section>
        <Separator />
        <section className="grid gap-8 py-9 md:grid-cols-3" aria-label="How it works">
          {[
            ['Bring the conversation', 'Paste a transcript from an interview you’ve already had.'],
            ['Find what matters', 'Explore each answer, with suggestions you can trace to the source.'],
            ['Take something forward', 'Save a revised answer and a few priorities for your next interview.'],
          ].map(([title, description], i) => <div key={title} className="flex gap-4"><span className="pt-0.5 text-xs tabular-nums text-muted-foreground">0{i + 1}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 max-w-64 text-xs leading-6 text-muted-foreground">{description}</p></div></div>)}
        </section>
        <Separator />
        <footer className="flex flex-wrap justify-between gap-4 py-6 text-[11px] text-muted-foreground"><span>Your experience. Your words. A clearer next step.</span><span>Designed for reflection, after the interview.</span></footer>
      </div>
    </main> : <main className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-wrap items-center gap-5 border-b bg-sidebar p-5 lg:flex-col lg:items-stretch lg:gap-8 lg:border-e lg:border-b-0 lg:py-8">
        <div className="me-auto px-1"><h2 className="text-sm font-medium">Your workspace</h2><p className="mt-2 text-[11px] text-muted-foreground">A place to reflect and prepare</p></div>
        <Button onClick={() => setModal('import')}><Plus data-icon="inline-start" />New review</Button>
        <div className="hidden lg:block"><p className={cn(eyebrow, 'mb-4 px-2')}>Your interviews</p><div className="space-y-2">
          {['Product designer · Acme', 'Design collaboration', 'Product designer · Northstar'].map((title, i) => <Button key={title} variant="ghost" className={cn('h-auto w-full justify-start px-3 py-3 text-start whitespace-normal', i === 0 && section === 'review' && 'bg-sidebar-accent')} onClick={() => i === 0 ? setSection('review') : toast.info('This prototype includes the Acme interview.')}><span className="text-xs">{title}<span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">{['Sep 14 · 6 questions', 'Sep 10 · Mock interview', 'Sep 06 · Real interview'][i]}</span></span></Button>)}
        </div></div>
        <nav className="flex w-full flex-wrap gap-2 lg:flex-col" aria-label="Workspace navigation">
          <Button variant="ghost" className="justify-start lg:hidden" onClick={() => setSection('review')}><FileText />Review</Button>
          <Button variant="ghost" className={cn('justify-start', section === 'saved' && 'bg-sidebar-accent')} onClick={() => setSection('saved')}><Bookmark />Saved answers<Badge variant="outline" className="ms-auto">{saved.length}</Badge></Button>
          <Button variant="ghost" className={cn('justify-start', section === 'priorities' && 'bg-sidebar-accent')} onClick={() => setSection('priorities')}><ListChecks />Preparation priorities</Button>
        </nav>
        <div className="mt-auto hidden items-center gap-3 px-2 pt-8 lg:flex"><Avatar><AvatarFallback>AL</AvatarFallback></Avatar><div className="text-xs">Alex<p className="mt-1 text-[11px] text-muted-foreground">Personal workspace</p></div></div>
      </aside>
      <section className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4 md:px-8"><div className="flex items-center gap-3 text-xs text-muted-foreground"><span>Your interviews</span><ChevronRight className="size-3" /><span className="text-foreground">{section === 'review' ? 'Acme' : section === 'saved' ? 'Saved answers' : 'Priorities'}</span></div><Button variant="ghost" size="sm" onClick={() => setModal('about')}>Sample workspace<Info /></Button></header>
        <div className="mx-auto max-w-[1500px] px-5 py-8 md:px-8">
          {section === 'review' ? <>
            <div className="mb-9 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-medium tracking-tight md:text-3xl">Product designer · Acme</h1><p className="mt-3 text-xs leading-6 text-muted-foreground">Real interview <span className="px-2">·</span> September 14, 2026 <span className="px-2">·</span> 6 question threads</p></div><Badge variant="outline" className="gap-1.5"><span className="size-1.5 rounded-full bg-primary" />Ready to review</Badge></div>
            <div className="grid gap-7 xl:grid-cols-[205px_minmax(0,1fr)]">
              <aside className="min-w-0"><div className={cn(eyebrow, 'mb-4 flex justify-between px-2')}><span>Question flow</span><span>06</span></div>
                <div className="flex gap-2 overflow-x-auto pb-3 xl:flex-col xl:overflow-visible">
                  {questions.map((item, i) => <Button key={item.short} variant="ghost" aria-pressed={selected === i} className={cn('h-auto w-48 shrink-0 items-start justify-start gap-3 px-3 py-4 text-start whitespace-normal xl:w-full', selected === i && 'bg-primary/5 ring-1 ring-inset ring-primary/20')} onClick={() => selectQuestion(i)}><span className={cn('pt-0.5 text-[11px] font-normal tabular-nums text-muted-foreground', selected === i && 'text-primary')}>0{i + 1}</span><span className="text-xs leading-5">{item.short}<span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">{item.category}{i === 1 ? ' · 1 follow-up' : ''}</span></span></Button>)}
                </div>
                <div className="mt-5 hidden px-2 xl:block"><Separator /><p className="mt-5 text-xs leading-6 text-muted-foreground">One conversation.<br />A few useful things to take forward.</p><Button variant="link" className="mt-2 px-0 text-xs" onClick={() => setSection('priorities')}>Preparation priorities<ArrowUpRight /></Button></div>
              </aside>
              <article className="min-w-0"><div className="flex items-center gap-2"><span className={eyebrow}>Question 0{selected + 1}</span><Badge variant="secondary">{q.category}</Badge></div><h2 className="mt-4 max-w-3xl text-2xl leading-snug font-medium tracking-tight md:text-[28px]">{q.title}</h2>
                <Tabs value={detailTab} onValueChange={value => setDetailTab(String(value))} className="mt-6 gap-6">
                  <div className="border-b pb-1"><TabsList variant="line" aria-label="Answer details"><TabsTrigger value="answer">Answer & suggestion</TabsTrigger><TabsTrigger value="source">Source transcript</TabsTrigger></TabsList></div>
                  <TabsContent value="answer">
                    <div className="grid gap-5 min-[1380px]:grid-cols-2">
                      <Card className="bg-muted/35"><CardHeader><CardTitle className={cn(eyebrow, 'flex items-center justify-between')}>Your original answer<ArrowDownLeft className="size-3.5" /></CardTitle></CardHeader><CardContent><p className="text-sm leading-7 text-muted-foreground">“{q.original}”</p><p className="mt-6 text-[11px] text-muted-foreground">As recorded in your transcript</p></CardContent></Card>
                      <Card className="bg-primary/5 ring-primary/15"><CardHeader><CardTitle className={cn(eyebrow, 'flex items-center justify-between text-primary')}>A proposed revision<ArrowUpRight className="size-3.5" /></CardTitle></CardHeader><CardContent><p className="text-sm leading-7">“{revisions[selected]}”</p><p className="mt-6 text-[11px] text-muted-foreground">A future answer, using your existing details</p></CardContent></Card>
                    </div>
                    <div className="flex gap-3 py-7"><CornerDownRight className="mt-0.5 size-4 shrink-0 text-primary" /><div><h3 className="text-sm font-medium">Why this suggestion</h3><p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">{q.why}</p></div></div>
                    <Separator /><div className="flex flex-wrap items-center justify-between gap-3 py-5"><div className="flex gap-2"><Button onClick={saveAnswer}>{saved.includes(selected) ? <Check /> : <Bookmark />}{saved.includes(selected) ? 'Answer saved' : 'Save this answer'}</Button><Button variant="ghost" onClick={editAnswer}>Edit revision</Button></div><Button variant="ghost" onClick={() => setDetailTab('source')}>View source<ArrowUpRight /></Button></div>
                    {selected === 1 && <Accordion><AccordionItem value="follow-up"><AccordionTrigger>1 follow-up in this conversation</AccordionTrigger><AccordionContent><p className="leading-7"><strong>Interviewer:</strong> What helped you reach an agreement?</p><p className="mt-2 leading-7"><strong>You:</strong> Seeing both options made it easier to talk about the differences.</p><p className="mt-3 text-muted-foreground">This supports the role of the prototype, but does not establish a business outcome.</p></AccordionContent></AccordionItem></Accordion>}
                  </TabsContent>
                  <TabsContent value="source"><Card><CardHeader><CardTitle className={eyebrow}>Acme · Original transcript · Sample data</CardTitle></CardHeader><CardContent className="space-y-5 text-sm leading-7"><p><strong>Interviewer:</strong> {q.title}</p><p><strong>You:</strong> {q.original}</p><p className="text-xs text-muted-foreground">Original wording is preserved. Revisions are saved separately.</p></CardContent></Card></TabsContent>
                </Tabs>
              </article>
            </div>
          </> : section === 'saved' ? <section className="max-w-3xl"><h1 className="text-3xl font-medium tracking-tight">Saved answers</h1><p className="mt-3 text-sm text-muted-foreground">Revised drafts to return to before your next conversation.</p><div className="mt-8 space-y-5">{saved.length ? saved.map(i => <Card key={i}><CardHeader><CardTitle>{questions[i].title}</CardTitle></CardHeader><CardContent><p className="text-sm leading-7 text-muted-foreground">{revisions[i]}</p></CardContent><CardFooter><span className="text-xs text-muted-foreground">Acme · Proposed future answer</span></CardFooter></Card>) : <Card><CardHeader><CardTitle>Keep an answer worth returning to.</CardTitle></CardHeader><CardContent><p className="mb-5 text-sm leading-7 text-muted-foreground">Save a revision from your interview review. It will appear here for the rest of this preview session.</p><Button variant="outline" onClick={() => setSection('review')}>Return to review<ArrowRight /></Button></CardContent></Card>}</div></section> : <section className="max-w-2xl"><h1 className="text-3xl font-medium tracking-tight">For your next interview</h1><p className="mt-3 text-sm text-muted-foreground">Keep up to three specific things you want to remember.</p><form className="mt-8 space-y-6" onSubmit={event => {event.preventDefault(); toast.success('Preparation priorities saved for this session.');}}>{priorities.map((value, i) => <div key={i} className="space-y-2"><Label htmlFor={`priority-${i}`}>Priority {i + 1}{i === 2 && ' · Optional'}</Label><Input id={`priority-${i}`} value={value} onChange={event => setPriorities(current => current.map((p, index) => index === i ? event.target.value : p))} /></div>)}<Button type="submit">Save priorities</Button><p className="text-xs text-muted-foreground">Changes last for this preview session.</p></form></section>}
        </div>
      </section>
    </main>}

    <Dialog open={modal !== null} onOpenChange={open => { if (!open) setModal(null); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {modal === 'import' ? <><DialogHeader><DialogTitle>Bring in your interview.</DialogTitle><DialogDescription>Paste or upload a transcript. This prototype opens a sample review; nothing is uploaded or analyzed.</DialogDescription></DialogHeader><div className="space-y-5 py-2"><div className="space-y-2"><Label htmlFor="role">Target role</Label><Input id="role" placeholder="e.g. Product designer" /></div><div className="space-y-2"><Label htmlFor="interview-type">Interview type</Label><Select defaultValue="real" items={[{value:'real', label:'Real interview'}, {value:'mock', label:'Mock interview'}]}><SelectTrigger id="interview-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="real">Real interview</SelectItem><SelectItem value="mock">Mock interview</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="transcript">Transcript</Label><Textarea id="transcript" className="min-h-32" placeholder={'Interviewer: Tell me about a time…\nYou: …'} /></div><div className="space-y-2"><Label htmlFor="transcript-file">Or select a plain-text file</Label><Input id="transcript-file" type="file" accept=".txt,text/plain" /></div></div><DialogFooter><Button onClick={() => {setModal(null); openExample();}}>Explore sample review<ArrowUpRight /></Button></DialogFooter></> : modal === 'edit' ? <><DialogHeader><DialogTitle>Make it sound like you.</DialogTitle><DialogDescription>Edit your proposed future answer. The original transcript stays unchanged.</DialogDescription></DialogHeader><form onSubmit={event => {event.preventDefault(); if (!draft.trim()) return; setRevisions(current => current.map((text, i) => i === selected ? draft.trim() : text)); setSaved(current => current.includes(selected) ? current : [...current, selected]); setModal(null); toast.success('Revision saved. Your original answer is unchanged.');}}><div className="space-y-2 pb-6"><Label htmlFor="revision">Your revision</Label><Textarea id="revision" className="min-h-40" required value={draft} onChange={event => setDraft(event.target.value)} /></div><DialogFooter><Button type="submit" disabled={!draft.trim()}>Save revision</Button></DialogFooter></form></> : <><DialogHeader><DialogTitle>A space to explore.</DialogTitle><DialogDescription>This prototype uses fictional sample content. Switch questions, inspect the source, edit revisions, save answers, and update preparation priorities.</DialogDescription></DialogHeader><p className="text-sm leading-7 text-muted-foreground">Changes are held for this page session. No transcript processing or account sign-in is connected.</p></>}
      </DialogContent>
    </Dialog>
    <Toaster theme="light" position="bottom-center" />
  </>;
}
