import { Card, CardContent, CardHeader } from '@/components/ui/card';

type AnswerReviewProps = {
  original: string;
  revised: string;
  why: string;
};

export function AnswerReview({ original, revised, why }: AnswerReviewProps) {
  return <>
    <div className="grid gap-4 @min-[38rem]:grid-cols-2">
      <Card className="bg-muted/35 [--card-spacing:--spacing(5)]">
        <CardHeader><h3 className="text-sm font-medium text-muted-foreground">Original answer</h3></CardHeader>
        <CardContent><p className="text-base leading-7">{original}</p></CardContent>
      </Card>
      <Card className="bg-primary/5 ring-primary/15 [--card-spacing:--spacing(5)]">
        <CardHeader><h3 className="text-sm font-medium text-primary">Proposed answer</h3></CardHeader>
        <CardContent><p className="text-base leading-7">{revised}</p><p className="mt-4 text-xs text-muted-foreground">For your next interview.</p></CardContent>
      </Card>
    </div>
    <div className="py-5">
      <h3 className="text-sm font-medium">Why this revision</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{why}</p>
    </div>
  </>;
}
