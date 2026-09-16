'use client';

import { useEffect, useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { cn } from '@/lib/utils';

const examples = [
  {
    category: 'Collaboration',
    question: 'Tell me about a time you disagreed with your team.',
    before: 'I ',
    highlight: 'put both options into a prototype',
    after: ' and walked the team through them.',
    title: 'A detail worth keeping',
    suggestion: 'The prototype makes your contribution concrete. Lead with that action, then explain how the team reached a decision.',
  },
  {
    category: 'Decision making',
    question: 'Tell me about a difficult trade-off.',
    before: 'I suggested testing because ',
    highlight: 'we still had questions about the flow',
    after: '.',
    title: 'Make your reasoning visible',
    suggestion: 'The uncertainty explains your recommendation. Connect the decision to test with what you needed to learn before shipping.',
  },
  {
    category: 'Ownership',
    question: 'Tell me about a project you are proud of.',
    before: 'I mapped the steps and ',
    highlight: 'removed a duplicate screen',
    after: ' after reviewing the flow with the team.',
    title: 'Give the outcome more detail',
    suggestion: 'Your action is specific. Add what changed for users, if you know, to explain why this project matters to you.',
  },
  {
    category: 'Self-awareness',
    question: 'How do you work with feedback?',
    before: 'I try to ',
    highlight: 'understand the problem before changing the design',
    after: '.',
    title: 'Ground your approach in a story',
    suggestion: 'Understanding the problem first is a clear approach. A specific example would help show how you put it into practice.',
  },
];
const eyebrow = 'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground';

export function ExampleCarousel() {
  const [api, setApi] = useState<CarouselApi>();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!api) return;
    const update = () => setActive(api.selectedScrollSnap());
    update();
    api.on('select', update);
    api.on('reInit', update);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => api.reInit({ duration: motion.matches ? 0 : 25 });
    updateMotion();
    motion.addEventListener('change', updateMotion);
    return () => {
      api.off('select', update);
      api.off('reInit', update);
      motion.removeEventListener('change', updateMotion);
    };
  }, [api]);

  return <div className="relative mx-auto w-full min-w-0 max-w-xl">
    <Carousel opts={{ loop: true }} setApi={setApi} aria-label="Interview review examples">
      {/* Clip in the tilted panel's coordinate space, then keep the cards upright. */}
      <div className="-rotate-2 overflow-hidden rounded-2xl bg-muted" data-slot="example-carousel-mask">
        <div className="rotate-2">
      <CarouselContent className="ml-0 items-stretch" viewportClassName="overflow-visible">
        {examples.map((example, index) => <CarouselItem key={example.category} className="flex px-5 py-6" aria-label={`${index + 1} of ${examples.length}: ${example.category}`} aria-hidden={active !== index}>
          <Card className="mx-0.5 w-full shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 border-b"><span className={eyebrow}>A look inside your review</span><Badge variant="secondary">Example</Badge></CardHeader>
            <CardContent className="flex flex-1 flex-col gap-6 py-3">
              <div><p className={eyebrow}>{example.category}</p><h2 className="mt-3 text-2xl leading-snug font-medium tracking-tight">“{example.question}”</h2></div>
              <div><p className={eyebrow}>From your original answer</p><p className="mt-3 text-sm leading-7 text-muted-foreground">“{example.before}<mark className="bg-primary/10 text-foreground">{example.highlight}</mark>{example.after}”</p></div>
              <div className="mt-auto rounded-lg bg-primary/5 p-5"><p className={cn(eyebrow, 'flex items-center gap-2 text-primary')}><CornerDownRight className="size-4 shrink-0" />{example.title}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{example.suggestion}</p></div>
            </CardContent>
          </Card>
        </CarouselItem>)}
      </CarouselContent>
        </div>
      </div>
      <div className="relative mt-2 flex items-center justify-center gap-3">
        <CarouselPrevious className="static size-10" />
        <div className="flex items-center" aria-label="Choose an example">{examples.map((example, index) => <Button key={example.category} size="icon" variant="ghost" className="size-10" aria-label={`Show ${example.category.toLowerCase()} example`} aria-pressed={active === index} onClick={() => api?.scrollTo(index)}><span className={cn('size-1.5 rounded-full bg-muted-foreground/30', active === index && 'w-4 bg-primary')} /></Button>)}</div>
        <CarouselNext className="static size-10" />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">Example {active + 1} of {examples.length}: {examples[active].category}</p>
    </Carousel>
  </div>;
}
