'use client';

import { to12h } from '@/lib/format';
import type { Task } from '@/lib/types';

const CATEGORY_DOT: Record<string, string> = {
  'deep-thinking': 'bg-blue-400/80',
  'deep-admin': 'bg-yellow-400/80',
  'multitask-admin': 'bg-orange-400/80',
  'meeting': 'bg-emerald-400/80',
  'personal': 'bg-white/30',
  'flex': 'bg-sky-400/80',
};

const TONE_TAG: Record<string, string> = {
  hot: 'border-red-400/30 bg-red-400/10 text-red-300',
  warm: 'border-amber-300/30 bg-amber-300/10 text-amber-300',
  cool: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function TaskCard({
  task,
  onClick,
  onToggleDone,
}: {
  task: Task;
  onClick: (task: Task) => void;
  onToggleDone: (task: Task, done: boolean) => void;
}) {
  const stuck = daysSince(task.updated_at);
  const tone = task.is_pinned ? 'ok' : stuck >= 7 ? 'hot' : stuck >= 3 ? 'warm' : 'cool';
  const toneClass = TONE_TAG[tone];
  const toneLabel = task.is_pinned ? '⭐ ONE THING' : stuck >= 7 ? 'HOT' : stuck >= 3 ? 'WARM' : 'COOL';
  const done = !!task.completed_at;

  return (
    <div
      onClick={() => onClick(task)}
      className={`group cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-white/[0.12] hover:bg-white/[0.04] ${
        done ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(task, !done);
          }}
          className={`mt-0.5 size-4 shrink-0 rounded border transition ${
            done
              ? 'border-emerald-400/60 bg-emerald-400/30'
              : 'border-white/20 hover:border-emerald-400/40 hover:bg-emerald-400/10'
          }`}
          aria-label={done ? 'Mark not done' : 'Mark done'}
        >
          {done && <span className="block text-center text-[10px] leading-none text-emerald-200">✓</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-sm leading-tight text-white/85 ${done ? 'line-through' : ''}`}>
            {task.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
            {task.category && (
              <span className="flex items-center gap-1">
                <span className={`size-1.5 rounded-full ${CATEGORY_DOT[task.category]}`} />
                {task.category}
              </span>
            )}
            {task.estimated_minutes && <span className="num">· {task.estimated_minutes}m</span>}
            {task.energy && <span>· {task.energy}</span>}
            {task.assigned_block_id && (
              <span className="text-emerald-300/70">
                · {task.assigned_block_id.replace(/-(\d{1,2}:\d{2})$/, (_, t) => ` · ${to12h(t)}`)}
              </span>
            )}
          </div>
          {task.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-white/40">
              {task.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] tracking-[0.18em] ${toneClass}`}>
          {toneLabel}
        </span>
      </div>
    </div>
  );
}
