'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

// Browser type for Web Speech Recognition (Chrome/Safari, non-standard)
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function JarvisVoice() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speakingRef = useRef(false);

  const speak = useCallback(async (textToSpeak: string) => {
    try {
      speakingRef.current = true;
      const res = await fetch('/api/jarvis/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSpeak, voice: 'onyx' }),
      });
      if (!res.ok) throw new Error(`speak ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        speakingRef.current = false;
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e) {
      speakingRef.current = false;
      setErr((e as Error).message);
    }
  }, []);

  const briefMe = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/jarvis/brief', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setText(body.text);
      await speak(body.text);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [speak]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      const next: ChatTurn[] = [...history, { role: 'user', content: message }];
      setHistory(next);
      setText(`You: ${message}`);
      try {
        const res = await fetch('/api/jarvis/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const reply = body.reply as string;
        setHistory((h) => [...h, { role: 'assistant', content: reply }]);
        setText(reply);
        await speak(reply);
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [history, speak],
  );

  // Always-listening mode wiring
  useEffect(() => {
    if (!listening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setErr('Browser does not support speech recognition. Try Chrome or Safari.');
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let finalChunks = '';
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      const m = finalChunks.trim();
      finalChunks = '';
      setTranscript('');
      if (m && !speakingRef.current) {
        await sendMessage(m);
      }
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunks += t + ' ';
        else interim += t;
      }
      setTranscript(finalChunks + interim);
      // After a 1.5s pause, send what we have
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        flush().catch(() => {});
      }, 1500);
    };
    rec.onerror = (e) => {
      const event = e as unknown as { error?: string };
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setErr(`speech: ${event.error || 'unknown'}`);
    };
    rec.onend = () => {
      if (listening) {
        // Auto-restart for continuous mode
        try { rec.start(); } catch { /* already started */ }
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // already started
    }
    return () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      try { rec.stop(); } catch {}
    };
  }, [listening, sendMessage]);

  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.03] p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Jarvis</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={briefMe}
            disabled={loading}
            className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {loading ? 'Briefing…' : 'Brief me'}
          </button>
          <button
            onClick={() => setListening((v) => !v)}
            className={`min-h-9 rounded-md border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition ${
              listening
                ? 'border-red-400/60 bg-red-400/20 text-red-300 animate-pulse'
                : 'border-white/15 bg-white/[0.04] text-white/65 hover:bg-white/[0.10]'
            }`}
            title={listening ? 'Stop listening' : 'Start listening (always-on)'}
          >
            {listening ? '● Listening' : '🎙 Listen'}
          </button>
        </div>
      </div>

      {err && <div className="mt-2 text-[11px] text-red-300/85">⚠ {err}</div>}

      {transcript && listening && (
        <div className="mt-2 text-[11px] italic text-white/45">{transcript}</div>
      )}

      {text && (
        <div className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80">
          {text}
        </div>
      )}

      {!text && !err && !listening && (
        <div className="mt-2 text-[11px] text-white/40">
          Tap <span className="text-emerald-300">Brief me</span> for today&apos;s overview, or{' '}
          <span className="text-white/60">🎙 Listen</span> to converse hands-free.
        </div>
      )}
    </div>
  );
}
