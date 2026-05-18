import { ReactNode } from 'react';

type PanelProps = {
  id?: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Glassmorphism panel — shared chrome for every dashboard card.
 * Header has a "NN //" prefix (Miles design) + meta on the right.
 */
export function Panel({ id, title, meta, children, className = '' }: PanelProps) {
  return (
    <section
      className={`rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm ${className}`}
    >
      <header className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
          {id && <span className="font-mono text-white/30">{id} //</span>}
          <span>{title}</span>
        </div>
        {meta && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{meta}</div>
        )}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}
