import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

/**
 * Transcribe audio bytes via OpenAI Whisper.
 * Telegram voice notes are OGG/Opus — Whisper accepts that with the right filename.
 */
export async function transcribeAudio(
  bytes: ArrayBuffer,
  filename: string = 'audio.ogg',
): Promise<string | null> {
  if (!openaiAvailable()) return null;
  try {
    const ext = filename.split('.').pop()?.toLowerCase() || 'ogg';
    const mimeMap: Record<string, string> = {
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      webm: 'audio/webm',
    };
    const blob = new Blob([bytes], { type: mimeMap[ext] || 'audio/ogg' });
    const file = new File([blob], filename, { type: blob.type });
    const res = await openaiClient().audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    return res.text || null;
  } catch (err) {
    console.error('[whisper] failed:', (err as Error).message);
    return null;
  }
}
