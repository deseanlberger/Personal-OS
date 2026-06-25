'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';
import { FinanceDashboard, type FinanceScope } from '@/components/dashboard/FinanceDashboard';

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
  subscription_status?: 'cancelled' | 'could_cancel' | null;
  source: string;
  receipt_image_url: string | null;
  needs_review?: boolean;
};

type ParsedReceipt = {
  vendor: string;
  amount: number;
  txn_date: string;
  category?: string;
  memo?: string;
  is_business_likely?: boolean;
};

type ParsedStatementTxn = {
  txn_date: string;
  amount: number;
  vendor: string;
  category: string;
  is_business: boolean;
  kind: 'purchase' | 'income' | 'refund' | 'transfer' | 'payment-to-card' | 'fee' | 'interest';
  memo?: string | null;
};

type StatementParseResult = {
  filename: string;
  statement_account_last4: string | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
  transactions: ParsedStatementTxn[];
};

// Defensive date formatter — Safari/iOS throws "The string did not match the
// expected pattern" if you call toLocaleDateString on an invalid Date. Most
// txn_date values are YYYY-MM-DD, but bulk-imported rows can occasionally
// contain ISO timestamps or other surprises; fall back to the raw value.
function formatTxnDate(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '';
  const datePart = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return value;
  const d = new Date(datePart + 'T00:00:00');
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [pendingParse, setPendingParse] = useState<ParsedReceipt | null>(null);
  const [scope, setScope] = useState<FinanceScope>('all');
  const [statementParse, setStatementParse] = useState<StatementParseResult | null>(null);
  const [statementParsing, setStatementParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [statementRowMeta, setStatementRowMeta] = useState<{ filenames: string[]; last4s: (string | null)[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statementInputRef = useRef<HTMLInputElement>(null);

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
        // User just confirmed in the modal, so persist as already-reviewed
        needs_review: false,
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

  const handleStatement = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setStatementParsing(true);
    setError(null);
    setParseProgress({ done: 0, total: list.length, current: list[0].name });
    const merged: StatementParseResult = {
      filename: list.length === 1 ? list[0].name : `${list.length} statements`,
      statement_account_last4: null,
      statement_period_start: null,
      statement_period_end: null,
      transactions: [],
    };
    const perRowFile: string[] = [];
    const perRowLast4: (string | null)[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        setParseProgress({ done: i, total: list.length, current: file.name });
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/finance/parse-statement', { method: 'POST', body: fd });
        const body = await res.json();
        if (!res.ok || !body.ok) {
          setError(`${file.name}: ${body.error || `parse failed (${res.status})`}`);
          continue;
        }
        const parsed = body as StatementParseResult;
        for (const t of parsed.transactions) {
          merged.transactions.push(t);
          perRowFile.push(file.name);
          perRowLast4.push(parsed.statement_account_last4);
        }
        // Take metadata from the first successful one
        if (!merged.statement_account_last4) merged.statement_account_last4 = parsed.statement_account_last4;
        if (!merged.statement_period_start) merged.statement_period_start = parsed.statement_period_start;
        if (parsed.statement_period_end) merged.statement_period_end = parsed.statement_period_end;
      }
      if (merged.transactions.length === 0) {
        if (!error) setError('No transactions parsed from any file');
        return;
      }
      setStatementParse(merged);
      setStatementRowMeta({ filenames: perRowFile, last4s: perRowLast4 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatementParsing(false);
      setParseProgress(null);
      if (statementInputRef.current) statementInputRef.current.value = '';
    }
  };

  const scanGmail = async () => {
    setScanning(true);
    setScanResult(null);
    setError(null);
    try {
      const res = await fetch('/api/finance/gmail-scan?hours=72', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error || `scan failed (${res.status})`);
        return;
      }
      setScanResult(
        `Scanned ${body.scanned} · found ${body.receipts_found} · inserted ${body.inserted} · dupes ${body.duplicates}`,
      );
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Finance</h1>
            <a href="/finance/subscriptions" className="text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/70">Subscriptions</a>
            <a href="/finance/net-worth" className="text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/70">Net worth</a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => statementInputRef.current?.click()}
              disabled={statementParsing}
              className="min-h-9 rounded-md border border-purple-400/40 bg-purple-400/15 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-purple-300 hover:bg-purple-400/25 disabled:opacity-40 sm:text-[11px]"
              title="Upload a credit card or bank statement PDF — Claude parses it"
            >
              {statementParsing
                ? parseProgress
                  ? `📄 ${parseProgress.done + 1}/${parseProgress.total}`
                  : '📄 Parsing…'
                : '📄 Statements'}
            </button>
            <button
              onClick={scanGmail}
              disabled={scanning}
              className="min-h-9 rounded-md border border-sky-400/40 bg-sky-400/15 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-sky-300 hover:bg-sky-400/25 disabled:opacity-40 sm:text-[11px]"
              title="Pull receipts and credit card alerts from Gmail (last 72h)"
            >
              {scanning ? '✉ Scanning…' : '✉ Gmail'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40 sm:text-[11px]"
            >
              {uploading ? '📷 Reading…' : '📷 Snap'}
            </button>
          </div>
          <input
            ref={statementInputRef}
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) handleStatement(files);
            }}
            className="hidden"
          />
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
        {scanResult && (
          <div className="rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-300">
            ✉ {scanResult}
          </div>
        )}

        {/* Personal / Business / All scope toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {(['all', 'personal', 'business'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`flex-1 rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
                scope === s
                  ? s === 'business'
                    ? 'bg-emerald-400/20 text-emerald-300'
                    : s === 'personal'
                      ? 'bg-sky-400/20 text-sky-300'
                      : 'bg-white/10 text-white/85'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* KJ-inspired dashboard: monthly tabs / 4 cards / donut / transfers / month-over-month / subscriptions */}
        <FinanceDashboard refreshKey={transactions.length} scope={scope} />

        {/* Pending parsed receipt */}
        {pendingParse && (
          <ParsedReceiptConfirm
            parsed={pendingParse}
            accounts={accounts}
            onSave={saveParsed}
            onCancel={() => setPendingParse(null)}
          />
        )}

        {statementParse && (
          <StatementReview
            result={statementParse}
            accounts={accounts}
            rowMeta={statementRowMeta}
            onDone={async () => {
              setStatementParse(null);
              setStatementRowMeta(null);
              await fetchAll();
            }}
            onCancel={() => {
              setStatementParse(null);
              setStatementRowMeta(null);
            }}
          />
        )}

        {/* Account quick-add CTA if none configured */}
        {accounts.length === 0 && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-300">
            ⚠ No accounts configured yet. <a href="/settings/accounts" className="underline">Add your cards/banks</a> so transactions
            can be tagged to the right account.
          </div>
        )}

        {/* Pending review */}
        <PendingReviewSection accounts={accounts} onChange={fetchAll} />

        {/* Transaction list — filtered by scope */}
        {(() => {
          const scoped = scope === 'all'
            ? transactions
            : transactions.filter((t) => (scope === 'business' ? t.is_business : !t.is_business));
          return (
        <section>
          <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">
            Transactions{scope !== 'all' ? ` · ${scope}` : ''}
          </h2>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
            {scoped.length === 0 && (
              <p className="px-4 py-6 text-sm text-white/40">
                {transactions.length === 0
                  ? 'No transactions yet. Tap 📷 Snap Receipt to log your first one.'
                  : `No ${scope} transactions in this window.`}
              </p>
            )}
            {scoped.map((t) => {
              const tone = (t.category && CATEGORY_TONE[t.category]) || CATEGORY_TONE.other;
              return (
                <div
                  key={t.id}
                  className="group flex items-center gap-2 border-b border-white/[0.04] px-3 py-3 last:border-0 hover:bg-white/[0.02] sm:gap-3 sm:px-4"
                >
                  <div className="num shrink-0 text-[10px] text-white/40 sm:text-[11px]">
                    {formatTxnDate(t.txn_date)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm text-white/85">{t.vendor || '(no vendor)'}</span>
                      {t.is_business && (
                        <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-emerald-300">
                          BIZ
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-white/35">
                      {t.account && <span className="truncate">{t.account.short_name || t.account.name}{t.account.last_4 ? ` ····${t.account.last_4}` : ''}</span>}
                      {t.category && (
                        <span className={`rounded border px-1 py-0 text-[9px] ${tone}`}>{t.category}</span>
                      )}
                    </div>
                  </div>
                  <div className="num shrink-0 text-sm text-white/90">${Number(t.amount).toFixed(2)}</div>
                  <select
                    value={t.subscription_status || ''}
                    onChange={async (e) => {
                      const v = (e.target.value || null) as 'cancelled' | 'could_cancel' | null;
                      await fetch(`/api/transactions/${t.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subscription_status: v }),
                      });
                      setTransactions((prev) => prev.map((x) => (x.id === t.id ? { ...x, subscription_status: v } : x)));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`hidden shrink-0 rounded-md border px-1.5 py-1 text-[10px] outline-none sm:block ${
                      t.subscription_status === 'cancelled'
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : t.subscription_status === 'could_cancel'
                          ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                          : 'border-white/10 bg-black/30 text-white/40'
                    }`}
                    title="Subscription status"
                  >
                    <option value="">—</option>
                    <option value="could_cancel">could cancel</option>
                    <option value="cancelled">cancelled</option>
                  </select>
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
          );
        })()}
      </div>
    </Shell>
  );
}

const CATEGORY_OPTIONS = [
  'food',
  'gas',
  'supplements',
  'athlete-fees',
  'rent',
  'software',
  'travel',
  'gym-equipment',
  'office',
  'medical',
  'other',
];

function PendingReviewSection({
  accounts,
  onChange,
}: {
  accounts: Account[];
  onChange: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/transactions?status=pending&days=180', { cache: 'no-store' });
      if (!res.ok) throw new Error(`pending ${res.status}`);
      const body = await res.json();
      setPending(body.transactions || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const approve = async (t: Transaction, patch: Partial<Transaction>) => {
    const res = await fetch(`/api/transactions/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, needs_review: false }),
    });
    if (res.ok) {
      await Promise.all([fetchPending(), onChange()]);
    }
  };

  const reject = async (id: string) => {
    if (!confirm('Discard this pending receipt?')) return;
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    await Promise.all([fetchPending(), onChange()]);
  };

  if (error) {
    return (
      <section className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
        Pending review failed: {error}
      </section>
    );
  }
  if (pending.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-300/85">
        Pending Review · {pending.length}
      </h2>
      <div className="space-y-2">
        {pending.map((t) => (
          <PendingReviewRow
            key={t.id}
            transaction={t}
            accounts={accounts}
            onApprove={(patch) => approve(t, patch)}
            onReject={() => reject(t.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PendingReviewRow({
  transaction,
  accounts,
  onApprove,
  onReject,
}: {
  transaction: Transaction;
  accounts: Account[];
  onApprove: (patch: Partial<Transaction>) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  // Vendor-based suggestion: pre-fill from the latest confirmed transaction
  // for the same vendor if we find one. Loose match, falls back to current values.
  const [accountId, setAccountId] = useState<string>(transaction.account_id || accounts[0]?.id || '');
  const [category, setCategory] = useState<string>(transaction.category || 'other');
  const [isBusiness, setIsBusiness] = useState<boolean>(transaction.is_business);
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    if (!transaction.vendor) return;
    let cancelled = false;
    fetch(`/api/transactions?status=confirmed&days=365`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body) => {
        if (cancelled) return;
        const vendor = transaction.vendor!.toLowerCase();
        const match = (body.transactions as Transaction[]).find(
          (x) => x.vendor?.toLowerCase() === vendor && x.id !== transaction.id,
        );
        if (match) {
          if (!transaction.account_id && match.account_id) setAccountId(match.account_id);
          if (!transaction.category && match.category) setCategory(match.category);
          if (!transaction.is_business && match.is_business) setIsBusiness(true);
          setSuggestion(
            `Past ${vendor}: ${match.category || 'other'} · ${match.is_business ? 'business' : 'personal'}`,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [transaction]);

  const submit = async () => {
    setPending(true);
    await onApprove({ account_id: accountId || null, category, is_business: isBusiness });
    setPending(false);
  };

  return (
    <div className="rounded-xl border border-amber-300/30 bg-amber-300/[0.04] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm text-white/90">{transaction.vendor || '(no vendor)'}</span>
            <span className="num text-sm text-amber-300">${Number(transaction.amount).toFixed(2)}</span>
          </div>
          <div className="mt-0.5 num text-[10px] uppercase tracking-[0.18em] text-white/40">
            {transaction.txn_date} · {transaction.source}
          </div>
          {transaction.memo && <div className="mt-0.5 text-[11px] italic text-white/55">{transaction.memo}</div>}
        </div>
      </div>

      {suggestion && (
        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-emerald-300/70">
          → suggested from history: {suggestion}
        </div>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/85 outline-none"
        >
          <option value="">— account —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.short_name || a.name}{a.last_4 ? ` ····${a.last_4}` : ''}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/85 outline-none"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex items-center rounded-md border border-white/10 bg-black/30 p-0.5">
          {(['personal', 'business'] as const).map((c) => {
            const active = (c === 'business') === isBusiness;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setIsBusiness(c === 'business')}
                className={`flex-1 rounded px-2 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
                  active ? 'bg-emerald-400/20 text-emerald-300' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onReject} className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-white/55 hover:bg-white/[0.04]">
          Discard
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
        >
          {pending ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
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

const KIND_TONE: Record<ParsedStatementTxn['kind'], string> = {
  purchase: 'border-white/15 text-white/85',
  refund: 'border-emerald-400/30 text-emerald-300',
  income: 'border-emerald-400/30 text-emerald-300',
  transfer: 'border-white/[0.06] text-white/30',
  'payment-to-card': 'border-white/[0.06] text-white/30',
  fee: 'border-amber-400/30 text-amber-300',
  interest: 'border-amber-400/30 text-amber-300',
};

const CATEGORY_OPTS = ['food','gas','supplements','athlete-fees','rent','software','travel','gym-equipment','office','medical','other'];

function StatementReview({
  result,
  accounts,
  rowMeta,
  onDone,
  onCancel,
}: {
  result: StatementParseResult;
  accounts: Account[];
  rowMeta?: { filenames: string[]; last4s: (string | null)[] } | null;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const initial = result.transactions.map((t, i) => ({
    ...t,
    include: t.kind === 'purchase' || t.kind === 'refund' || t.kind === 'fee' || t.kind === 'interest',
    _filename: rowMeta?.filenames[i] || result.filename,
    _last4: rowMeta?.last4s[i] || result.statement_account_last4,
  }));
  const [rows, setRows] = useState(initial);
  const accountIdByLast4 = (last4: string | null | undefined) => {
    if (!last4) return '';
    const m = accounts.find((a) => a.last_4 === last4);
    return m?.id || '';
  };
  const [accountId, setAccountId] = useState<string>(() => {
    const last4 = result.statement_account_last4;
    if (last4) {
      const match = accounts.find((a) => a.last_4 === last4);
      if (match) return match.id;
    }
    return accounts[0]?.id || '';
  });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const update = (i: number, patch: Partial<typeof rows[number]>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const summary = rows.reduce(
    (acc, r) => {
      if (!r.include) return acc;
      if (r.amount > 0) acc.spent += r.amount;
      else acc.income += Math.abs(r.amount);
      if (r.is_business) acc.business += Math.max(0, r.amount);
      acc.count++;
      return acc;
    },
    { spent: 0, income: 0, business: 0, count: 0 },
  );

  const save = async () => {
    if (!accountId) {
      setSaveResult('Pick an account first');
      return;
    }
    setSaving(true);
    setSaveResult(null);
    const payload = {
      account_id: accountId,
      source: `statement-${result.filename}`.slice(0, 80),
      transactions: rows
        .filter((r) => r.include)
        .map((r) => {
          const perRowAccount = accountIdByLast4(r._last4);
          return {
            txn_date: r.txn_date,
            amount: r.amount,
            vendor: r.vendor,
            category: r.category,
            is_business: r.is_business,
            memo: r.memo || null,
            account_id: perRowAccount || accountId || null,
          };
        }),
    };
    try {
      const res = await fetch('/api/transactions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setSaveResult(body.error || `save failed (${res.status})`);
      } else {
        setSaveResult(`Inserted ${body.inserted} · skipped ${body.skipped} dupes`);
        setTimeout(() => onDone(), 1200);
      }
    } catch (e) {
      setSaveResult((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-400/30 bg-purple-400/[0.04] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-purple-300/85">
            Statement preview · {result.filename}
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            {result.statement_period_start && result.statement_period_end
              ? `${result.statement_period_start} → ${result.statement_period_end}`
              : 'Period unknown'}
            {result.statement_account_last4 && ` · card ····${result.statement_account_last4}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none"
          >
            <option value="">— pick account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.short_name || a.name}{a.last_4 ? ` ····${a.last_4}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2 text-[11px]">
        <div className="rounded-md border border-white/[0.06] bg-black/30 px-2 py-1.5">
          <div className="text-white/40">Selected</div>
          <div className="num text-white/85">{summary.count}</div>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-black/30 px-2 py-1.5">
          <div className="text-white/40">Spend</div>
          <div className="num text-white/85">${summary.spent.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-black/30 px-2 py-1.5">
          <div className="text-white/40">Income</div>
          <div className="num text-emerald-300">${summary.income.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-black/30 px-2 py-1.5">
          <div className="text-white/40">Business</div>
          <div className="num text-emerald-300">${summary.business.toFixed(2)}</div>
        </div>
      </div>

      {/* Desktop: table; Mobile: stacked cards */}
      <div className="max-h-[480px] overflow-y-auto rounded-md border border-white/[0.06]">
        <table className="hidden w-full text-[11px] sm:table">
          <thead className="sticky top-0 bg-black/80 text-[10px] uppercase tracking-[0.14em] text-white/40">
            <tr>
              <th className="px-2 py-1.5 text-left">✓</th>
              <th className="px-2 py-1.5 text-left">Date</th>
              <th className="px-2 py-1.5 text-left">Vendor</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
              <th className="px-2 py-1.5 text-left">Category</th>
              <th className="px-2 py-1.5 text-left">Biz</th>
              <th className="px-2 py-1.5 text-left">Kind</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t border-white/[0.04] ${r.include ? '' : 'opacity-40'}`}>
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => update(i, { include: e.target.checked })}
                  />
                </td>
                <td className="num px-2 py-1 text-white/60">{r.txn_date.slice(5)}</td>
                <td className="px-2 py-1">
                  <input
                    value={r.vendor}
                    onChange={(e) => update(i, { vendor: e.target.value })}
                    className="w-full rounded border border-transparent bg-transparent px-1 text-white/85 outline-none focus:border-white/15 focus:bg-black/40"
                  />
                </td>
                <td className={`num px-2 py-1 text-right ${r.amount < 0 ? 'text-emerald-300' : 'text-white/85'}`}>
                  ${Math.abs(r.amount).toFixed(2)}
                </td>
                <td className="px-2 py-1">
                  <select
                    value={r.category}
                    onChange={(e) => update(i, { category: e.target.value })}
                    className="w-full rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[10px] text-white/85 outline-none"
                  >
                    {CATEGORY_OPTS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={r.is_business}
                    onChange={(e) => update(i, { is_business: e.target.checked })}
                  />
                </td>
                <td className={`px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${KIND_TONE[r.kind]}`}>
                  {r.kind}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: stacked card list */}
        <ul className="divide-y divide-white/[0.04] sm:hidden">
          {rows.map((r, i) => (
            <li key={i} className={`flex gap-2 p-3 ${r.include ? '' : 'opacity-40'}`}>
              <input
                type="checkbox"
                checked={r.include}
                onChange={(e) => update(i, { include: e.target.checked })}
                className="mt-1 size-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <input
                    value={r.vendor}
                    onChange={(e) => update(i, { vendor: e.target.value })}
                    className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 text-sm text-white/85 outline-none focus:border-white/15 focus:bg-black/40"
                  />
                  <span className={`num shrink-0 text-sm ${r.amount < 0 ? 'text-emerald-300' : 'text-white/85'}`}>
                    ${Math.abs(r.amount).toFixed(2)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="num text-white/40">{r.txn_date.slice(5)}</span>
                  <span className={`uppercase tracking-[0.14em] ${KIND_TONE[r.kind]}`}>{r.kind}</span>
                  <select
                    value={r.category}
                    onChange={(e) => update(i, { category: e.target.value })}
                    className="rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[10px] text-white/85 outline-none"
                  >
                    {CATEGORY_OPTS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <label className="ml-auto flex items-center gap-1 text-white/55">
                    <input
                      type="checkbox"
                      checked={r.is_business}
                      onChange={(e) => update(i, { is_business: e.target.checked })}
                    />
                    biz
                  </label>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-white/50">
          {saveResult || 'Uncheck rows you don’t want imported. Transfers / payments-to-card default off.'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/60 hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !accountId}
            className="rounded-md border border-purple-400/40 bg-purple-400/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:bg-purple-400/25 disabled:opacity-40"
          >
            {saving ? 'Saving…' : `Import ${summary.count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
