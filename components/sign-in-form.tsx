'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export function SignInForm() {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const client = useQueryClient();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/auth/${register ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST', headers: register ? { 'x-invitation-token': String(form.get('invitation')) } : {},
        body: JSON.stringify({ email: String(form.get('email')).trim().toLowerCase(), password: form.get('password'), ...(register ? { name: form.get('name') } : {}) }),
      });
      client.clear(); router.replace('/reviews');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); }
    finally { setPending(false); }
  }
  return <section className="mx-auto max-w-md py-16">
    <p className="text-sm text-muted-foreground">Interview Coach · Invited pilot</p>
    <h1 className="mt-3 text-3xl font-medium">{register ? 'Accept your invitation' : 'Welcome back'}</h1>
    <p className="mt-3 text-sm text-muted-foreground">{register ? 'Use the invitation code shared with you to create your account.' : 'Sign in to your private interview reviews.'}</p>
    <form onSubmit={submit} className="mt-8 space-y-5">
      {register && <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" autoComplete="name" required maxLength={100} /></div>}
      <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required />{register && <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>}</div>
      {register && <div className="space-y-2"><Label htmlFor="invitation">Invitation code</Label><Input id="invitation" name="invitation" autoComplete="off" minLength={32} maxLength={256} required /></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button>
    </form>
    <Button variant="ghost" onClick={() => { setRegister(!register); setError(''); }} disabled={pending} className="mt-4">{register ? 'Already have an account? Sign in' : 'Have an invitation? Create account'}</Button>
  </section>;
}
