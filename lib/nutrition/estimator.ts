import { z } from 'zod';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

export const MacroSchema = z.object({
  name: z.string().min(1).max(140),
  kcal: z.number().int().min(0).max(5000),
  p: z.number().min(0).max(500),  // grams protein
  c: z.number().min(0).max(800),  // grams carbs
  f: z.number().min(0).max(500),  // grams fat
  notes: z.string().max(200).optional(),
});

export type Macro = z.infer<typeof MacroSchema>;

const SYSTEM_PROMPT = `You are a sports nutritionist estimating calories and macros from a meal description.

Output JSON ONLY matching this shape:
{
  "name": "short meal name (under 80 chars, normalized — e.g. 'Chicken bowl' not 'i ate a chicken bowl')",
  "kcal": <integer total calories>,
  "p": <grams protein>,
  "c": <grams carbs>,
  "f": <grams fat>,
  "notes": "optional one-line note about portion assumption"
}

Rules:
- Assume typical restaurant/home portions unless quantities are specified.
- Round kcal to nearest 5, grams to nearest 1.
- Always satisfy kcal ≈ 4*p + 4*c + 9*f (within 10%).
- If the input is vague (e.g. "lunch"), give your best estimate and flag in notes.`;

function safeJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Estimate macros for a text meal description (Claude primary, OpenAI fallback). */
export async function estimateMacrosFromText(text: string): Promise<Macro | null> {
  if (claudeAvailable()) {
    try {
      const msg = await claudeClient().messages.create({
        model: claudeModel(),
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      });
      const block = msg.content[0];
      if (block?.type === 'text') {
        const parsed = safeJson(block.text);
        try {
          return MacroSchema.parse(parsed);
        } catch {}
      }
    } catch (err) {
      console.error('[macroEstimator] Claude failed:', (err as Error).message);
    }
  }

  if (openaiAvailable()) {
    try {
      const res = await openaiClient().chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      });
      const content = res.choices[0]?.message?.content;
      if (content) {
        const parsed = safeJson(content);
        try {
          return MacroSchema.parse(parsed);
        } catch {}
      }
    } catch (err) {
      console.error('[macroEstimator] OpenAI failed:', (err as Error).message);
    }
  }

  return null;
}

/** Re-distribute macros for a meal at a new kcal target (preserves the food name). */
export async function redistributeMacros(name: string, kcal: number): Promise<Macro | null> {
  const prompt = `Re-estimate macros for "${name}" at ${kcal} kcal. Same meal, but assume the portion adjusts to hit the new calorie target. Output JSON.`;
  return estimateMacrosFromText(prompt);
}

/** Estimate macros from a food photo (OpenAI GPT-4o vision). */
export async function estimateMacrosFromImage(imageBase64DataUri: string): Promise<Macro | null> {
  if (!openaiAvailable()) return null;
  try {
    const res = await openaiClient().chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify what is in this photo and estimate the macros for the whole portion shown. Output JSON only.' },
            { type: 'image_url', image_url: { url: imageBase64DataUri, detail: 'low' } },
          ],
        },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = safeJson(content);
    return MacroSchema.parse(parsed);
  } catch (err) {
    console.error('[macroEstimator] image failed:', (err as Error).message);
    return null;
  }
}
