'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type Account = {
  id: string;
  name: string;
  short_name: string | null;
  last_4: string | null;
  type: string;
  category: 'personal' | 'business';
  notes: string | null;
};

const TYPES = ['credit', 'debit', 'cash', 'savings', 'checking', 'other'] as const;

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const fetchAll = useCallback(async () => {
    const res = await fetch('/api/accounts', { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      setAccounts(body.accounts || []);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const personal = accounts.filter((a) => a.category === 'personal');
  const business = accounts.filter((a) => a.category === 'business');

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
              Settings // Accounts
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Add your cards + bank accounts. Receipts get tagged to one of these when you log them.
            </p>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25"
          >
            {showAdd ? 'Cancel' : '+ New Account'}
          </button>
        </header>

        {showAdd && <NewAccountForm onCreated={() => { setShowAdd(false); fetchAll(); }} />}

        <AccountList title="Business" accounts={business} onChanged={fetchAll} />
        <AccountList title="Personal" accounts={personal} onChanged={fetchAll} />
      </div>
    </Shell>
  );
}

function AccountList({ title, accounts, onChanged }: { title: string; accounts: Account[]; onChanged: () => void }) {
  if (accounts.length === 0) return null;
  const remove = async (id: string) => {
    if (!confirm('Remove this account?')) return;
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    onChanged();
  };
  const setCategory = async (a: Account, newCategory: 'personal' | 'business') => {
    if (a.category === newCategory) return;
    await fetch(`/api/accounts/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newCategory }),
    });
    onChanged();
  };
  return (
    <section>
      <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">{title}</h2>
      <div className="space-y-1">
        {accounts.map((a) => (
          <div key={a.id} className="group flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white/85">
                {a.name}{a.last_4 ? <span className="ml-1 num text-white/40">····{a.last_4}</span> : null}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
                {a.type}
              </div>
            </div>
            <div className="flex items-center rounded-md border border-white/10 bg-black/30 p-0.5">
              {(['personal', 'business'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(a, c)}
                  className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${
                    a.category === c
                      ? 'bg-emerald-400/20 text-emerald-300'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              onClick={() => remove(a.id)}
              className="text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function NewAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [last4, setLast4] = useState('');
  const [type, setType] = useState<typeof TYPES[number]>('credit');
  const [category, setCategory] = useState<'personal' | 'business'>('personal');
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        short_name: shortName.trim() || null,
        last_4: last4.trim() || null,
        type,
        category,
      }),
    });
    if (res.ok) {
      setName(''); setShortName(''); setLast4('');
      onCreated();
    }
    setPending(false);
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Full name (e.g. "Chase Sapphire Reserve")' className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none" />
      <div className="grid grid-cols-3 gap-2">
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Short (CSR)" className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none" />
        <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Last 4 (1234)" inputMode="numeric" className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none num" />
        <select value={type} onChange={(e) => setType(e.target.value as typeof TYPES[number])} className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none">
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 text-sm text-white/80">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">Category:</span>
        <div className="flex items-center rounded-md border border-white/10 bg-black/30 p-0.5">
          {(['personal', 'business'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
                category === c
                  ? 'bg-emerald-400/20 text-emerald-300'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={!name.trim() || pending} className="w-full rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40">
        {pending ? 'Adding…' : 'Add Account'}
      </button>
    </form>
  );
}
