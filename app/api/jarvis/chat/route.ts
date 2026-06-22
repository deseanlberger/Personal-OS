import { NextRequest, NextResponse } from 'next/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { supabase } from '@/lib/supabase/server';
import { embed } from '@/lib/embeddings';

const USER_ID = process.env.USER_ID || 'desean';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * POST /api/jarvis/chat  { message: string, history?: ChatTurn[] }
 *
 * Conversational Jarvis endpoint. Embeds the message, pulls the most-relevant
 * memory chunks for context, and asks Claude to respond in the Jarvis voice
 * (British butler, dry wit, terse — meant to be spoken aloud).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  const message = body.message.trim().slice(0, 1000);
  const history: ChatTurn[] = Array.isArray(body.history) ? body.history.slice(-8) : [];

  if (!claudeAvailable()) {
    return NextResponse.json({ reply: "I apologise, sir, my linguistics module is offline." });
  }

  // Pull relevant memory via semantic search
  let memoryContext = '';
  try {
    const vec = await embed(message);
    if (vec) {
      const { data: matches } = await supabase.rpc('search_memory', {
        query_embedding: vec as unknown as string,
        match_count: 8,
        user_id_filter: USER_ID,
      });
      if (matches && matches.length > 0) {
        memoryContext = (matches as { source_type: string; text: string; created_at: string }[])
          .map((m) => `[${m.source_type} · ${m.created_at.slice(0, 10)}] ${m.text.slice(0, 300)}`)
          .join('\n');
      }
    }
  } catch {
    // best-effort memory; proceed without it
  }

  const systemPrompt = `You are Jarvis from Iron Man — Desean Berger's personal AI butler. He is a head strength coach at Odyssey Performance.

Voice: polite, dry-witted, British servant. Use "sir" naturally but sparingly — every other reply, not every sentence. Keep responses short and spoken-friendly (under 80 words, no markdown, no lists). Numbers spoken-style ("fourteen" not "14"). Times like "9 AM". This is being read aloud by TTS — write the way a human butler would speak.

You have access to Desean's notes/tasks/journal/captures via the context below. Use them when relevant. If you don't know something, say so plainly.

Don't moralise. Don't add empty acknowledgments ("Of course, sir!"). Just answer or act.${memoryContext ? `\n\nRelevant memory:\n${memoryContext}` : ''}`;

  const messages = [
    ...history,
    { role: 'user' as const, content: message },
  ];

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 350,
      system: systemPrompt,
      messages,
    });
    const block = msg.content[0];
    const reply = block?.type === 'text' ? block.text.trim() : "I'm afraid I have nothing for you, sir.";
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
