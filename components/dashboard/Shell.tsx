import { ReactNode } from 'react';
import { TopRail } from './TopRail';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--ink-0)] text-white">
      <TopRail />
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
