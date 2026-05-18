import Link from 'next/link';
import { Shell } from '@/components/dashboard/Shell';

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  status: 'live' | 'soon';
};

const SECTIONS: SettingsLink[] = [
  {
    href: '/settings/blocks',
    title: 'Block Template',
    description: 'Edit your weekly schedule — rename athletes, change times, add/remove blocks. Changes apply to all future weeks.',
    status: 'live',
  },
  {
    href: '/settings/accounts',
    title: 'Accounts',
    description: 'Add your cards + bank accounts. Receipts get tagged to the right account when logged.',
    status: 'live',
  },
  {
    href: '/settings/habits',
    title: 'Habits',
    description: 'Change which habits show on the Habit Tracker. Add new ones, remove old, rename.',
    status: 'soon',
  },
  {
    href: '/settings/profile',
    title: 'Profile',
    description: 'Your name, role, location, focus, photo. Shows in the Operator card.',
    status: 'soon',
  },
  {
    href: '/settings/integrations',
    title: 'Integrations',
    description: 'Telegram bot (Jarvis), Apple Health iOS Shortcut, future Google Calendar push + finance sheet.',
    status: 'live',
  },
];

export default function SettingsIndexPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="pb-2">
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
            Settings
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Configure your Personal OS.
          </p>
        </header>

        <div className="space-y-2">
          {SECTIONS.map((s) => {
            const isSoon = s.status === 'soon';
            const className = `block rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition ${
              isSoon ? 'cursor-default opacity-60' : 'hover:border-white/[0.12] hover:bg-white/[0.04]'
            }`;
            const inner = (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-white/85">{s.title}</div>
                  {isSoon && (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/30">soon</span>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-white/50">{s.description}</p>
              </>
            );
            return isSoon ? (
              <div key={s.href} className={className}>
                {inner}
              </div>
            ) : (
              <Link key={s.href} href={s.href} className={className}>
                {inner}
              </Link>
            );
          })}
        </div>

        <div className="pt-4">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/50 hover:bg-white/[0.04] hover:text-white/80"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
