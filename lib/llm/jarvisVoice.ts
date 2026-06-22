import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

// Jarvis voice config — shared by /api/jarvis/speak and /api/jarvis/brief-audio
// so they always sound identical.
//
// Model: gpt-4o-mini-tts supports natural-language voice instructions, which is
// how we get the Iron Man butler vibe out of a generic TTS voice. The `ash`
// voice is the deepest of the new lineup; with the instructions below it
// reads as a refined British AI butler.
const JARVIS_MODEL = 'gpt-4o-mini-tts';
const JARVIS_VOICE = 'ash';
const JARVIS_INSTRUCTIONS = `You are J.A.R.V.I.S. — Tony Stark's AI butler.

Speak with a refined, RP British accent — articulate, measured, slightly cool. Polite servant tone with dry wit underneath. Pace is moderate and deliberate, never rushed. Subtle warmth, but always composed and professional. Slightly synthetic resonance, as if produced by a sophisticated AI.

Avoid sounding overly American, casual, or theatrical. Do not over-emphasize. Speak as if delivering information to a busy genius who needs it precisely.`;

export async function jarvisTTS(text: string): Promise<ArrayBuffer> {
  if (!openaiAvailable()) {
    throw new Error('OpenAI not configured');
  }
  const trimmed = text.slice(0, 4000);
  // The SDK's audio.speech.create accepts an `instructions` param when the
  // model supports it (gpt-4o-mini-tts). Older `tts-1` ignores it.
  const response = await openaiClient().audio.speech.create({
    model: JARVIS_MODEL,
    voice: JARVIS_VOICE,
    input: trimmed,
    response_format: 'mp3',
    instructions: JARVIS_INSTRUCTIONS,
  });
  return await response.arrayBuffer();
}
