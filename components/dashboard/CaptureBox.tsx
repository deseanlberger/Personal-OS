'use client';

import { useState } from 'react';
import { emit, EVENTS } from '@/lib/events';

type Status = 'idle' | 'pending' | 'success' | 'error';

type CaptureResponse = {
  raw_capture_id: string;
  routed_to: 'tasks' | null;
  routed_id: string | null;
  classification: {
    kind: string;
    urgency: string;
    category: string | null;
    summary: string;
  };
  llm_source: 'claude' | 'openai' | 'regex';
};

export function CaptureBox() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [last, setLast] = useState<CaptureResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || status === 'pending') return;
    setStatus('pending');
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, source: 'web' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[CaptureBox] /api/capture failed', res.status, body);
        setStatus('error');
        setTimeout(() => setStatus('idle'), 2500);
        return;
      }
      const body = (await res.json()) as CaptureResponse;
      setLast(body);
      setText('');
      setStatus('success');
      emit(EVENTS.CAPTURE_SAVED);
      if (body.routed_to === 'tasks') emit(EVENTS.TASK_CHANGED);
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      console.error('[CaptureBox] network error', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  }

  const buttonLabel =
    status === 'pending' ? 'Sending…' :
    status === 'success' ? '✓ Captured' :
    status === 'error' ? '⚠️ Error' :
    'Capture';

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2"
    >
      <span className="text-white/30">⌘</span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          last
            ? `Last: ${last.classification.kind.toUpperCase()} · ${last.classification.summary.slice(0, 40)}${last.classification.summary.length > 40 ? '…' : ''}`
            : 'Capture — type a thought, task, or note…'
        }
        className="flex-1 bg-transparent text-sm text-white/80 outline-none placeholder-white/30"
        disabled={status === 'pending'}
      />
      <button
        type="submit"
        disabled={status === 'pending' || !text.trim()}
        className={`min-h-9 rounded-md border px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
          status === 'success'
            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
            : status === 'error'
              ? 'border-red-400/40 bg-red-400/10 text-red-300'
              : 'border-white/10 text-white/60 hover:bg-white/[0.04]'
        }`}
      >
        {buttonLabel}
      </button>
    </form>
  );
}
