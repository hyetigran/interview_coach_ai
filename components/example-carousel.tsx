'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';

const examples = [
  {
    category: 'Collaboration',
    question: 'Tell me about a time you disagreed with your team.',
    before: 'I ',
    highlight: 'put both options into a prototype',
    after: ' and walked the team through them.',
    suggestion: 'Lead with the prototype. It shows your contribution to resolving the disagreement.',
  },
  {
    category: 'Decision making',
    question: 'Tell me about a difficult trade-off.',
    before: 'I suggested testing because ',
    highlight: 'we still had questions about the flow',
    after: '.',
    suggestion: 'Explain what you needed to learn before shipping. That’s why you recommended testing.',
  },
  {
    category: 'Ownership',
    question: 'Tell me about a project you are proud of.',
    before: 'I mapped the steps and ',
    highlight: 'removed a duplicate screen',
    after: ' after reviewing the flow with the team.',
    suggestion: 'Add what changed for users, if you know. Keep the outcome grounded in what happened.',
  },
  {
    category: 'Self-awareness',
    question: 'How do you work with feedback?',
    before: 'I try to ',
    highlight: 'understand the problem before changing the design',
    after: '.',
    suggestion: 'Add an example of feedback that changed your design. Show how you used this approach.',
  },
];

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

  return <div className="@container relative mx-auto w-full min-w-0 max-w-xl">
    <Carousel opts={{ loop: true }} setApi={setApi} aria-label="Interview review examples">
      {/* Clip in the tilted panel's coordinate space, then keep the cards upright. */}
      <div className="-rotate-2 overflow-hidden rounded-2xl bg-muted" data-slot="example-carousel-mask">
        <div className="rotate-2">
      <CarouselContent className="ml-0 items-stretch" viewportClassName="overflow-visible">
        {examples.map((example, index) => <CarouselItem key={example.category} className="flex px-5 py-6" aria-label={`${index + 1} of ${examples.length}: ${example.category}`} aria-hidden={active !== index}>
          <Card className="mx-0.5 w-full shadow-sm [--card-spacing:--spacing(4)]">
            <CardHeader className="flex flex-row items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{example.category}</span><Badge variant="secondary">Sample</Badge></CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <h2 className="text-lg leading-snug font-medium tracking-tight @min-[26rem]:text-xl">{example.question}</h2>
              <div className="grid flex-1 gap-4 @min-[26rem]:grid-cols-2">
                <div><p className="text-xs font-medium text-muted-foreground">Original answer</p><p className="mt-2 text-sm leading-6">“{example.before}<mark className="rounded-sm bg-primary/10 px-0.5 text-foreground">{example.highlight}</mark>{example.after}”</p></div>
                <div className="rounded-lg bg-primary/5 p-3"><p className="text-xs font-medium text-primary">Suggestion</p><p className="mt-2 text-sm leading-6">{example.suggestion}</p></div>
              </div>
            </CardContent>
          </Card>
        </CarouselItem>)}
      </CarouselContent>
        </div>
      </div>
      <div className="relative mt-3 flex items-center justify-center gap-4">
        <CarouselPrevious variant="ghost" className="static size-11" />
        <span className="min-w-8 text-center text-xs tabular-nums text-muted-foreground" aria-hidden="true">{active + 1} / {examples.length}</span>
        <CarouselNext variant="ghost" className="static size-11" />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">Example {active + 1} of {examples.length}: {examples[active].category}</p>
    </Carousel>
  </div>;
}
