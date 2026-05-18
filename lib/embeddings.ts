import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;

export async function embed(text: string): Promise<number[] | null> {
  if (!openaiAvailable()) return null;
  try {
    const res = await openaiClient().embeddings.create({
      model: EMBED_MODEL,
      input: text.slice(0, 8000),
    });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.error('[embeddings] failed:', (err as Error).message);
    return null;
  }
}

export { EMBED_DIMS };
