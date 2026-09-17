import Link from 'next/link';
export default function Home() {
  return <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16"><p className="text-sm text-primary">Interview Coach · Invited pilot</p><h1 className="text-5xl font-medium tracking-tight">A clearer next answer.</h1><p className="max-w-lg leading-7 text-muted-foreground">A private workspace for reflecting on your hiring and mock interviews, and preparing for the next conversation.</p><div className="flex gap-5"><Link href="/reviews" className="rounded-lg bg-primary px-5 py-3 text-primary-foreground">Open your workspace</Link><Link href="/example" className="rounded-lg border px-5 py-3">Explore the fictional example</Link></div></main>;
}
