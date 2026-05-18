'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const search = useSearchParams();
  const next = search.get('next') || '/';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Login failed');
        setPending(false);
        return;
      }
      // Hard navigation, NOT router.replace. iOS Safari sometimes races
      // the SPA navigation with cookie commit; full page load guarantees
      // the auth cookie is sent on the next request.
      window.location.href = next;
    } catch {
      setError('Network error');
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur"
    >
      <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">
        Personal OS
      </div>
      <h1 className="mb-6 text-2xl font-medium text-white/90">Sign in</h1>
      <input
        type="text"
        autoFocus
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="go"
        maxLength={20}
        value={password}
        onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
        placeholder="PIN"
        aria-label="PIN"
        style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
        className="w-full min-h-12 rounded-md border border-white/10 bg-black/40 px-3 py-3 text-base tracking-[0.4em] text-white/90 placeholder-white/30 outline-none focus:border-emerald-400/50"
      />
      {error && <p className="mt-3 text-sm text-red-400/90">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full min-h-12 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-3 text-base font-medium text-emerald-300 transition hover:bg-emerald-400/25 active:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Enter'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-start justify-center px-6 pt-16">
      <Suspense fallback={<div className="text-white/40">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
