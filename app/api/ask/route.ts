import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { embed } from '@/lib/embeddings';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';

const USER_ID = process.env.USER_ID || 'desean';
const TOP_K = 20;
const CHUNK_TRUNCATE = 400;

type Match = {
  id: string;
  source_type: string;
  source_id: string;
  text: string;
  similarity: number;
  created_at: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.question || typeof body.question !== 'string') {
    return NextResponse.json({ error: 'question required' }, { status: 400 });
  }
  const question = body.question.trim().slice(0, 500);

  const vec = await embed(question);
  if (!vec) {
    return NextResponse.json({ error: 'embedding failed — OPENAI_API_KEY missing?' }, { status: 500 });
  }

  const { data: matches, error } = await supabase.rpc('search_memory', {
    query_embedding: vec as unknown as string,
    match_count: TOP_K,
    user_id_filter: USER_ID,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sources = (matches || []) as Match[];
  if (sources.length === 0) {
    return NextResponse.json({ answer: "I don't have anything in your captures about that.", sources: [] });
  }

  if (!claudeAvailable()) {
    return NextResponse.json({
      answer: 'Claude unavailable — returning raw matches.',
      sources,
    });
  }

  const context = sources
    .map((m) => `[${m.id.slice(0, 8)}] (${m.source_type}, ${m.created_at.slice(0, 10)}): ${m.text.slice(0, CHUNK_TRUNCATE)}`)
    .join('\n\n');

  const systemPrompt = `You are Desean Berger's personal AI assistant with access to his captures, tasks, journals, decisions, meals, and habits.

Answer the user's question using ONLY the context provided below. Cite the sources you reference by including the [bracketed ID] inline, e.g. "You mentioned the gym idea on Mar 4 [a3f9d2e1]."

If the context doesn't contain enough information to answer, say "I don't have anything in your captures about that."

Be concise. Don't repeat the question. Don't preface with "Based on your captures…".

Context:
${context}`;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
    });
    const block = msg.content[0];
    const answer = block?.type === 'text' ? block.text : 'No response.';
    return NextResponse.json({ answer, sources });
  } catch (err) {
    console.error('[/api/ask] Claude failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
