import { NextRequest, NextResponse } from 'next/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { supabase } from '@/lib/supabase/server';
import { z } from 'zod';

const USER_ID = process.env.USER_ID || 'desean';

export const maxDuration = 60;

const ParsedTransaction = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  vendor: z.string(),
  category: z.enum([
    'food', 'gas', 'supplements', 'athlete-fees', 'rent', 'software',
    'travel', 'gym-equipment', 'office', 'medical', 'other',
  ]),
  is_business: z.boolean(),
  kind: z.enum(['purchase', 'income', 'refund', 'transfer', 'payment-to-card', 'fee', 'interest']),
  memo: z.string().nullable().optional(),
});

const ParseResponse = z.object({
  statement_account_last4: z.string().nullable(),
  statement_period_start: z.string().nullable(),
  statement_period_end: z.string().nullable(),
  transactions: z.array(ParsedTransaction),
});

const EXTRACTION_PROMPT = `Extract every transaction from this credit card or bank statement.

For each transaction, output JSON with:
- txn_date: 'YYYY-MM-DD' (infer the year from the statement period — statements show MM/DD only)
- amount: positive for money OUT (purchases, fees, interest), negative for money IN (income, refunds, returns)
- vendor: clean merchant name (strip prefixes like "AMAZON MKTPL*BV57O5F72" → "Amazon", "SP+AFF* ETHOS FIT" → "Ethos Fit", "EXERCISE.COM BUSINESS" → "Exercise.com")
- category: pick ONE from: food, gas, supplements, athlete-fees, rent, software, travel, gym-equipment, office, medical, other
- is_business: TRUE if it's a coaching/training/business expense. FALSE for personal.

  CARD DEFAULTS (use these to bias your decision; flip per-row only when the vendor strongly suggests otherwise):
  - Card ending 4316 (Chase Freedom): BUSINESS RECURRING / SUBSCRIPTIONS card — default is_business=true for ALL charges. This card is dedicated to business software subscriptions (Exercise.com, HighLevel, Train Heroic, Zapier, Anthropic, ElevenLabs, Recall, Riverside.fm, SmartWaiver, Output Sports recurring). Flip to false ONLY for unambiguously personal vendors that slipped onto this card by accident (clear groceries, restaurants, personal Amazon orders). When in doubt on 4316 → mark business.
  - Card ending 2860 (Chase Freedom Unlimited): PERSONAL CARD — default is_business=false. Flip to true only for clear business vendors (Exercise.com, HighLevel, Output Sports, VALD, Train Heroic, Zapier, Anthropic, ElevenLabs, Recall, Riverside.fm, SmartWaiver, Google Workspace, Staples).
  - Apple Card: PERSONAL CARD — default is_business=false. Apple.com subscriptions are personal unless clearly business (e.g. Ring AI Pro for work transcription = business).
  - Card ending 1160 (USAA): BUSINESS CARD — default is_business=true. Flip to false for clear personal (Walmart, restaurants, Bier Garden, Vuori clothing, Spectrum personal, LAZ Parking when not for a work trip, Monarch Money personal finance).
  - Card ending 6839 or 5265 (Chase debit / checking): MIXED — categorize per-vendor (Exercise.com Pay = personal income, Anthropic / Meta ads / Wodify / Square Payroll = business, Vons/Costco/restaurants = personal, Zelle to Landlord = personal rent).
  - Unknown / no card identified: MIXED — categorize per-vendor.

  KEY VENDORS that are ALWAYS business regardless of card: Exercise.com, HighLevel, Output Sports, Output Performance, VALD, Train Heroic, Zapier, Anthropic, OpenAI, ElevenLabs, Recall, Riverside.fm, SmartWaiver, Wodify, Canva, Weebly, Paddle.com, Meta/Facebook ads, IRS estimated tax, EDD, Wispr, Tella, OpenPhone (Quo), Google Workspace, Square Payroll.

  KEY VENDORS that are ALWAYS personal regardless of card: Amazon, Target, Walmart, Costco (groceries), Vons, Stater Bros, Albertsons, In-N-Out, Chick-fil-A, restaurants, ARCO, Chevron, Shell, Spectrum Mobile (personal), Disney+, Spotify, Apple Music, Apple.com subscriptions, Home Depot (unless clearly for gym), Dick's Sporting Goods personal, Vuori, Team Fan Shop, Fit Radio.
- kind: 'purchase' (normal card spending), 'refund' (negative amount, returns), 'income' (negative — Exercise.com Pay deposits, Venmo Cashout), 'transfer' (Online Transfer To/From Sav, Zelle Payment To Landlord — internal moves), 'payment-to-card' (Payment Thank You-Mobile, Payment To Chase Card), 'fee' (foreign transaction fee, monthly service fee), 'interest' (PURCHASE INTEREST CHARGE)
- memo: optional short note if useful

IMPORTANT:
- Skip nothing — include EVERY line item. Mark transfers/payment-to-card with appropriate kind so the app can filter them out later.
- For bank statements: "Exercise.Com Pay" entries are payroll income (kind=income, negative amount, vendor='Exercise.com Payroll', category='other', is_business=false — this is personal income to Desean)
- "Online Transfer To/From Sav" → kind=transfer (these are internal account moves, will be filtered out)
- "Zelle Payment To Landlord" or "Online Domestic Wire Transfer ... Effenberger Living Trust" → kind=purchase, category=rent, is_business=false
- "Square Inc Payroll" → kind=transfer (Desean paying his own business payroll, ignore for personal finance)
- "Pl*Rpg" debits → kind=transfer (likely investment account funding) UNLESS clearly identified otherwise
- IRS Usataxpymt → kind=purchase, category=other, memo='IRS tax payment'
- Employment Devel Edd → kind=purchase, category=other, memo='EDD tax payment'

OUTPUT ONLY VALID JSON in this exact shape:
{
  "statement_account_last4": "4316",
  "statement_period_start": "2026-04-29",
  "statement_period_end": "2026-05-28",
  "transactions": [
    { "txn_date": "2026-04-28", "amount": 17.79, "vendor": "Amazon", "category": "other", "is_business": false, "kind": "purchase", "memo": null },
    ...
  ]
}`;

/**
 * POST /api/finance/parse-statement — multipart form with field `file` (PDF)
 *
 * Sends the PDF to Claude with extraction instructions and returns the
 * structured transaction list for client-side review/approve before saving.
 */
export async function POST(req: NextRequest) {
  if (!claudeAvailable()) {
    return NextResponse.json({ error: 'Claude not configured' }, { status: 500 });
  }
  let buffer: Buffer;
  let filename = 'statement.pdf';
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file required (multipart field "file")' }, { status: 400 });
    }
    filename = file.name || filename;
    const ab = await file.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch (err) {
    return NextResponse.json({ error: `bad form: ${(err as Error).message}` }, { status: 400 });
  }

  const base64Pdf = buffer.toString('base64');

  // Pull the user's configured accounts so the prompt knows which cards are
  // business vs personal. Falls back to the hardcoded last-4 hints in the
  // prompt if the lookup fails.
  let accountsHint = '';
  try {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('name, short_name, last_4, type, category')
      .eq('user_id', USER_ID);
    if (accounts && accounts.length > 0) {
      accountsHint = '\n\nUSER\'S CONFIGURED ACCOUNTS (use these to set is_business default):\n' +
        accounts.map((a) => `- ${a.short_name || a.name}${a.last_4 ? ` (····${a.last_4})` : ''} · ${a.type} · ${a.category.toUpperCase()}`).join('\n') +
        '\n\nIf the statement\'s account matches one of these, default is_business from the account category. Override per-row only when the vendor strongly disagrees.';
    }
  } catch {
    // best effort
  }

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 8000,
      system: 'You extract structured transaction data from bank and credit card statements. Output VALID JSON only — no markdown, no explanations.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
            },
            { type: 'text', text: EXTRACTION_PROMPT + accountsHint },
          ],
        },
      ],
    });

    const block = msg.content[0];
    if (!block || block.type !== 'text') {
      return NextResponse.json({ error: 'no text response from model' }, { status: 500 });
    }
    const text = block.text;
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s < 0 || e < 0) {
      return NextResponse.json({ error: 'no JSON in model response', raw: text.slice(0, 500) }, { status: 500 });
    }
    let parsed;
    try {
      parsed = JSON.parse(text.slice(s, e + 1));
    } catch (err) {
      return NextResponse.json({ error: `JSON parse failed: ${(err as Error).message}` }, { status: 500 });
    }
    const validated = ParseResponse.safeParse(parsed);
    if (!validated.success) {
      return NextResponse.json({
        error: 'schema validation failed',
        issues: validated.error.issues.slice(0, 5),
        raw: parsed,
      }, { status: 500 });
    }
    return NextResponse.json({ ok: true, filename, ...validated.data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
