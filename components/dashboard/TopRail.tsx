'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';

const TABS = [
  { href: '/', label: 'HOME' },
  { href: '/today', label: 'TODAY' },
  { href: '/crm', label: 'CRM' },
  { href: '/journal', label: 'JOURNAL' },
  { href: '/brain', label: 'BRAIN' },
  { href: '/library', label: 'LIBRARY' },
  { href: '/finance', label: 'FINANCE' },
  { href: '/workout', label: 'WORKOUT' },
  { href: '/review', label: 'REVIEW' },
];

function formatClock(d: Date) {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).toUpperCase();
}

export function TopRail() {
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const refreshPage = () => {
    setRefreshing(true);
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 sm:gap-4 sm:px-6 sm:py-3">
      <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
        <button
          onClick={refreshPage}
          disabled={refreshing}
          aria-label="Refresh page"
          title="Refresh entire page (PWA-friendly)"
          className="flex min-h-9 min-w-9 items-center justify-center rounded-md border border-white/10 text-white/50 transition hover:bg-white/[0.04] hover:text-white disabled:opacity-40"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={refreshing ? 'animate-spin' : ''}
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <span className="ml-1 hidden size-1.5 rounded-full bg-emerald-400 sm:inline-block" />
        <span className="hidden text-white/60 md:inline">PERSONAL OS</span>
        <span className="hidden text-white/25 lg:inline">// V0.1</span>
      </div>
      <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 sm:gap-1 [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-h-11 shrink-0 items-center rounded-md px-2 py-2 text-[10px] tracking-[0.16em] transition sm:px-3 sm:text-[11px] sm:tracking-[0.18em] ${
                active
                  ? 'bg-white/[0.07] text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-white/40 sm:gap-4">
        <span className="hidden lg:inline">BTC <span className="text-white/70">$—</span></span>
        <span className="hidden lg:inline">NDX <span className="text-white/70">—</span></span>
        <span className="hidden lg:inline">XAU <span className="text-white/70">$—</span></span>
        {now && (
          <>
            <span className="hidden md:inline">{formatDate(now)}</span>
            <span className="hidden text-white/70 sm:inline">{formatClock(now)}</span>
          </>
        )}
        <Link
          href="/settings"
          aria-label="Settings"
          className={`hidden min-h-9 min-w-9 items-center justify-center rounded-md border transition sm:flex ${
            pathname.startsWith('/settings')
              ? 'border-white/20 bg-white/[0.07] text-white'
              : 'border-white/10 text-white/50 hover:bg-white/[0.04] hover:text-white/80'
          }`}
        >
          {/* gear icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
        <Link href="/settings/profile" aria-label="Profile" className="block shrink-0">
          <Avatar initials="DB" className="hover:border-white/20" />
        </Link>
      </div>
    </header>
  );
}
