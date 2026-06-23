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
  const [inputText, setInputText] = useState('');
  const [thinking, setThinking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speakingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Persist conversation across page reloads so the chat feels continuous.
  // localStorage key versioned to allow future schema changes without crashes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('jarvis_chat_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as ChatTurn[];
        if (Array.isArray(parsed)) setHistory(parsed.slice(-30));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('jarvis_chat_v1', JSON.stringify(history.slice(-30)));
    } catch {
      // quota issues: not worth crashing the UI
    }
    // Pin chat to the bottom on new message
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  // Reusable audio element so iOS keeps it "unlocked" after the first tap.
  // We create it lazily, but always inside a user gesture.
  const primedRef = useRef(false);
  const getAudioEl = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const primeAudio = useCallback(async () => {
    if (primedRef.current) return;
    const a = getAudioEl();
    // Play a silent data URL to unlock subsequent .play() calls on iOS.
    // 0.1s of pure silence MP3 (RFC-3550 compliant, ~80 bytes).
    a.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//FH///WyXJedZKgJoFqQAA';
    try {
      await a.play();
      a.pause();
      primedRef.current = true;
    } catch {
      // First play may still fail; treat as best-effort
    }
  }, [getAudioEl]);

  const briefMe = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setText(null);
    // 1. Prime the audio element synchronously (inside the user-tap context)
    await primeAudio();
    // 2. Hit the combined brief-audio endpoint — single fetch, text via header.
    try {
      const res = await fetch('/api/jarvis/brief-audio', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const textHeader = res.headers.get('X-Brief-Text');
      if (textHeader) setText(decodeURIComponent(textHeader));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = getAudioEl();
      const prevSrc = a.src;
      a.src = url;
      speakingRef.current = true;
      a.onended = () => {
        speakingRef.current = false;
        URL.revokeObjectURL(url);
      };
      try {
        await a.play();
      } catch (e) {
        if (prevSrc && prevSrc.startsWith('blob:')) URL.revokeObjectURL(prevSrc);
        throw new Error(`audio.play blocked: ${(e as Error).message}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getAudioEl, primeAudio]);

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
      const a = getAudioEl();
      a.src = url;
      a.onended = () => {
        speakingRef.current = false;
        URL.revokeObjectURL(url);
      };
      await a.play();
    } catch (e) {
      speakingRef.current = false;
      setErr((e as Error).message);
    }
  }, [getAudioEl]);

  const sendMessage = useCallback(
    async (message: string, opts: { speakReply?: boolean } = {}) => {
      if (!message.trim()) return;
      const next: ChatTurn[] = [...history, { role: 'user', content: message }];
      setHistory(next);
      setErr(null);
      setThinking(true);
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
        if (opts.speakReply) await speak(reply);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setThinking(false);
      }
    },
    [history, speak],
  );

  const submitInput = useCallback(async () => {
    const message = inputText.trim();
    if (!message || thinking) return;
    setInputText('');
    await sendMessage(message);
  }, [inputText, thinking, sendMessage]);

  const clearHistory = useCallback(() => {
    if (history.length === 0) return;
    if (!confirm('Clear chat with Jarvis?')) return;
    setHistory([]);
    setText(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('jarvis_chat_v1');
    }
  }, [history]);

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
        await sendMessage(m, { speakReply: true });
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
            onClick={async () => {
              await primeAudio();
              setListening((v) => !v);
            }}
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
        <div className="mt-2 text-[11px] italic text-white/45">› {transcript}</div>
      )}

      {/* Chat history. Stays mounted so the conversation is always there. */}
      <div
        ref={scrollRef}
        className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-md border border-white/[0.06] bg-black/30 p-2 sm:max-h-80"
      >
        {history.length === 0 && !text && (
          <div className="px-1 py-3 text-[11px] text-white/40">
            Type below or tap <span className="text-emerald-300">Brief me</span> /{' '}
            <span className="text-white/60">🎙 Listen</span> to start a conversation.
          </div>
        )}
        {/* Initial brief response (from Brief Me) shown above any chat */}
        {text && history.length === 0 && (
          <div className="rounded-md border border-emerald-400/15 bg-emerald-400/[0.04] px-2 py-1.5 text-[12px] leading-relaxed text-white/85">
            {text}
          </div>
        )}
        {history.map((turn, i) => (
          <div
            key={i}
            className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed ${
                turn.role === 'user'
                  ? 'bg-emerald-400/20 text-emerald-50'
                  : 'border border-white/[0.08] bg-white/[0.04] text-white/85'
              }`}
            >
              {turn.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/40">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Text input — always visible, even while listening */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitInput();
        }}
        className="mt-2 flex items-center gap-1.5"
      >
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask Jarvis anything…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white/85 outline-none placeholder:text-white/30 focus:border-emerald-400/40"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || thinking}
          className="min-h-9 shrink-0 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
        >
          Send
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            title="Clear chat"
            className="min-h-9 shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          >
            ×
          </button>
        )}
      </form>
    </div>
  );
}
