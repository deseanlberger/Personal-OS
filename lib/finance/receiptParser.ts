import { z } from 'zod';
import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

export const ReceiptSchema = z.object({
  vendor: z.string().min(1).max(140),
  amount: z.number().min(0).max(50000),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().max(40).optional(),
  memo: z.string().max(200).optional(),
  is_business_likely: z.boolean().optional(),
});

export type ParsedReceipt = z.infer<typeof ReceiptSchema>;

const SYSTEM_PROMPT = `You parse photos of receipts for Desean Berger, head coach at Odyssey Performance.

Output JSON ONLY:
{
  "vendor": "store name as printed",
  "amount": <total in dollars, e.g. 12.50>,
  "txn_date": "YYYY-MM-DD (from receipt; if missing, use today)",
  "category": "food | gas | supplements | athlete-fees | rent | software | travel | gym-equipment | office | medical | other",
  "memo": "short note about what was bought",
  "is_business_likely": true | false
}

Heuristics:
- Categorize "Vitamin Shoppe", "Bulk Supplements" → supplements
- "Chevron", "Shell", "76" → gas
- Restaurants, grocery → food
- Software subscriptions (Adobe, Notion, Linear, etc.) → software
- Gym equipment vendors (Rogue, Eleiko, PerformBetter) → gym-equipment
- "is_business_likely=true" if the vendor is clearly a business expense (athlete-fees,
  software, gym-equipment, office supplies). Otherwise false.
- If date is missing/unclear, output today's date.`;

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

export async function parseReceiptFromImage(imageBase64DataUri: string): Promise<ParsedReceipt | null> {
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
            { type: 'text', text: 'Parse this receipt photo and output JSON.' },
            { type: 'image_url', image_url: { url: imageBase64DataUri, detail: 'high' } },
          ],
        },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = safeJson(content);
    return ReceiptSchema.parse(parsed);
  } catch (err) {
    console.error('[receiptParser] failed:', (err as Error).message);
    return null;
  }
}
