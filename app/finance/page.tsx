'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type Account = {
  id: string;
  name: string;
  short_name: string | null;
  last_4: string | null;
  type: string;
  category: 'personal' | 'business';
};

type Transaction = {
  id: string;
  account_id: string | null;
  account: Account | null;
  txn_date: string;
  amount: number;
  vendor: string | null;
  category: string | null;
  memo: string | null;
  is_business: boolean;
  source: string;
  receipt_image_url: string | null;
};

type ParsedReceipt = {
  vendor: string;
  amount: number;
  txn_date: string;
  category?: string;
  memo?: string;
  is_business_likely?: boolean;
};

const CATEGORY_TONE: Record<string, string> = {
  food: 'border-amber-300/30 bg-amber-300/10 text-amber-300',
  gas: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  supplements: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  'athlete-fees': 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  rent: 'border-purple-400/30 bg-purple-400/10 text-purple-300',
  software: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  travel: 'border-pink-400/30 bg-pink-400/10 text-pink-300',
  'gym-equipment': 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  office: 'border-white/15 bg-white/[0.04] text-white/70',
  medical: 'border-red-400/30 bg-red-400/10 text-red-300',
  other: 'border-white/10 bg-black/30 text-white/50',
};

export default function FinancePage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingParse, setPendingParse] = useState<ParsedReceipt | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [txnRes, accRes] = await Promise.all([
        fetch('/api/transactions?days=30', { cache: 'no-store' }),
        fetch('/api/accounts', { cache: 'no-store' }),
      ]);
      if (txnRes.ok) {
        const body = await txnRes.json();
        setTransactions(body.transactions || []);
      }
      if (accRes.ok) {
        const body = await accRes.json();
        setAccounts(body.accounts || []);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handlePhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/transactions/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, mime: file.type || 'image/jpeg' }),
      });
      const body = await res.json();
      if (!body.parsed) {
        setError(body.error || 'parse failed');
        return;
      }
      setPendingParse(body.parsed as ParsedReceipt);
    } catch (e) {
      setError((e as Error).message);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveParsed = async (override: Partial<Transaction>) => {
    if (!pendingParse) return;
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txn_date: pendingParse.txn_date,
        amount: pendingParse.amount,
        vendor: pendingParse.vendor,
        category: pendingParse.category || null,
        memo: pendingParse.memo || null,
        is_business: pendingParse.is_business_likely ?? false,
        source: 'photo',
        raw_parse: pendingParse,
        ...override,
      }),
    });
    if (res.ok) {
      setPendingParse(null);
      await fetchAll();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'save failed');
    }
  };

  const deleteTransaction = async (id: string) => {
    if (!confirm('Delete this transaction?')) return;
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  // Aggregates for the strip at the top
  const totals30d = transactions.reduce(
    (a, t) => {
      const amt = Number(t.amount) || 0;
      if (amt > 0) {
        a.spent += amt;
        if (t.is_business) a.business += amt;
        else a.personal += amt;
      }
      return a;
    },
    { spent: 0, personal: 0, business: 0 },
  );

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
            Finance // Last 30d
          </h1>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {uploading ? '📷 Reading…' : '📷 Snap Receipt'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
            }}
            className="hidden"
          />
        </header>

        {error && <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">⚠ {error}</div>}

        {/* Top stats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Total spent</div>
            <div className="num mt-1 text-2xl text-white/90">${totals30d.spent.toFixed(2)}</div>
            <div className="mt-1 text-[10px] text-white/30">last 30 days · {transactions.length} txns</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Personal</div>
            <div className="num mt-1 text-2xl text-white/90">${totals30d.personal.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Business</div>
            <div className="num mt-1 text-2xl text-emerald-300/90">${totals30d.business.toFixed(2)}</div>
            <div className="mt-1 text-[10px] text-white/30">tax write-off pool</div>
          </div>
        </div>

        {/* Pending parsed receipt */}
        {pendingParse && (
          <ParsedReceiptConfirm
            parsed={pendingParse}
            accounts={accounts}
            onSave={saveParsed}
            onCancel={() => setPendingParse(null)}
          />
        )}

        {/* Account quick-add CTA if none configured */}
        {accounts.length === 0 && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-300">
            ⚠ No accounts configured yet. <a href="/settings/accounts" className="underline">Add your cards/banks</a> so transactions
            can be tagged to the right account.
          </div>
        )}

        {/* Transaction list */}
        <section>
          <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">Transactions</h2>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
            {transactions.length === 0 && (
              <p className="px-4 py-6 text-sm text-white/40">
                No transactions yet. Tap 📷 Snap Receipt to log your first one.
              </p>
            )}
            {transactions.map((t) => {
              const tone = (t.category && CATEGORY_TONE[t.category]) || CATEGORY_TONE.other;
              return (
                <div
                  key={t.id}
                  className="group flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 last:border-0 hover:bg-white/[0.02]"
                >
                  <div className="num shrink-0 text-[11px] text-white/40">
                    {new Date(t.txn_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm text-white/85">{t.vendor || '(no vendor)'}</span>
                      {t.is_business && (
                        <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-emerald-300">
                          BIZ
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
                      {t.account && <span>{t.account.short_name || t.account.name}{t.account.last_4 ? ` ····${t.account.last_4}` : ''}</span>}
                      {t.category && (
                        <span className={`rounded border px-1 py-0 text-[9px] ${tone}`}>{t.category}</span>
                      )}
                      {t.source !== 'manual' && <span>· {t.source}</span>}
                    </div>
                  </div>
                  <div className="num shrink-0 text-sm text-white/90">${Number(t.amount).toFixed(2)}</div>
                  <button
                    onClick={() => deleteTransaction(t.id)}
                    className="shrink-0 text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80"
                    aria-label="Delete transaction"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function ParsedReceiptConfirm({
  parsed,
  accounts,
  onSave,
  onCancel,
}: {
  parsed: ParsedReceipt;
  accounts: Account[];
  onSave: (override: Partial<Transaction>) => Promise<void>;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [isBusiness, setIsBusiness] = useState(parsed.is_business_likely ?? false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    await onSave({ account_id: accountId || null, is_business: isBusiness });
    setPending(false);
  };

  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-emerald-300">
        Receipt parsed — confirm + log
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Vendor</div>
          <div className="text-sm text-white/85">{parsed.vendor}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Amount</div>
          <div className="num text-sm text-white/85">${parsed.amount.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Date</div>
          <div className="num text-sm text-white/85">{parsed.txn_date}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Category</div>
          <div className="text-sm text-white/85">{parsed.category || 'other'}</div>
        </div>
      </div>
      {parsed.memo && <div className="mt-2 text-[11px] italic text-white/60">{parsed.memo}</div>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Account</div>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
          >
            <option value="">— none —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.last_4 ? ` ····${a.last_4}` : ''} ({a.category})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-white/85">
          <input
            type="checkbox"
            checked={isBusiness}
            onChange={(e) => setIsBusiness(e.target.checked)}
            className="size-4 accent-emerald-400"
          />
          Business expense
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/[0.04]">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-400/25"
        >
          {pending ? 'Saving…' : 'Save transaction'}
        </button>
      </div>
    </div>
  );
}
