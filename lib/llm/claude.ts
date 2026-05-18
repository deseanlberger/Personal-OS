import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

export function claudeClient(): Anthropic {
  const apiKey = getKey();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
}

export function claudeAvailable(): boolean {
  const k = getKey();
  return !!k && k.length > 10;
}
