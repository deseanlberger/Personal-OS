import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

export function openaiClient(): OpenAI {
  const apiKey = getKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

export function openaiClassifierModel(): string {
  return process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini';
}

export function openaiAvailable(): boolean {
  const k = getKey();
  return !!k && k.length > 10;
}
