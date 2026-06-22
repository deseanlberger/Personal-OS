import { z } from 'zod';
import { supabase } from '@/lib/supabase/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * Gmail receipt scanner.
 *
 * Looks for messages from the last N hours that smell like receipts/invoices
 * (subject + sender heuristics, e.g. order confirmations, payment receipts).
 * Each candidate body is sent to Claude with a structured extraction prompt.
 * Successful extractions land in transactions with needs_review=true so they
 * surface in /finance's Pending Review queue.
 *
 * Requires env vars (none are checked in):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_GMAIL_REFRESH_TOKEN
 *
 * Setup (one time on your Mac):
 *   1. console.cloud.google.com → enable Gmail API
 *   2. OAuth consent screen → add your gmail as test user
 *   3. Credentials → OAuth client (Desktop) → download client_secret.json
 *   4. Run a one-shot auth flow (oauth2-cli or playground) with scope
 *      https://www.googleapis.com/auth/gmail.readonly to get a refresh
 *      token. Paste it into Vercel env.
 *   5. Hit POST /api/finance/gmail-scan or wait for the hourly cron.
 */

const ReceiptExtraction = z.object({
  is_receipt: z.boolean(),
  vendor: z.string().nullable(),
  amount: z.number().nullable(),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  category: z.string().nullable(),
  memo: z.string().nullable(),
  is_business_likely: z.boolean().nullable(),
});

type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

type GmailMessageMeta = {
  id: string;
  threadId: string;
};

type GmailMessage = GmailMessageMeta & {
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { mimeType: string; body?: { data?: string } }[];
  };
};

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth not configured — missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_GMAIL_REFRESH_TOKEN');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Gmail token exchange returned no access_token');
  return body.access_token;
}

async function listCandidateMessages(accessToken: string, sinceHours: number): Promise<GmailMessageMeta[]> {
  // Heuristic query: receipt-shaped subjects AND credit-card charge alerts
  // from the last N hours. newer_than:Nd is supported by Gmail search.
  const days = Math.max(1, Math.ceil(sinceHours / 24));
  const subjectTerms = [
    'subject:receipt',
    'subject:invoice',
    'subject:order',
    'subject:"thanks for your order"',
    'subject:"payment received"',
    'subject:"transaction alert"',
    'subject:"transaction on"',
    'subject:"card was used"',
    'subject:"purchase alert"',
    'subject:"large purchase"',
    'subject:"new charge"',
    'subject:"charge approved"',
  ].join(' OR ');
  const senderTerms = [
    'from:no-reply',
    'from:noreply',
    'from:alerts@chase.com',
    'from:alerts@discover.com',
    'from:notify@discover.com',
    'from:secure@bankofamerica.com',
    'from:alerts@notify.wellsfargo.com',
    'from:no.reply.alerts@chase.com',
    'from:capitalone.com',
    'from:americanexpress.com',
    'from:citi.com',
  ].join(' OR ');
  const query = encodeURIComponent(`(${subjectTerms} OR ${senderTerms}) newer_than:${days}d`);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=80&q=${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
  const body = (await res.json()) as { messages?: GmailMessageMeta[] };
  return body.messages || [];
}

async function fetchMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Gmail fetch failed: ${res.status}`);
  return (await res.json()) as GmailMessage;
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractMessageText(message: GmailMessage): { subject: string; from: string; body: string } {
  const headers = Object.fromEntries(
    message.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
  );
  const subject = headers['subject'] || '';
  const from = headers['from'] || '';

  // Prefer text/plain. If not present, strip tags from text/html.
  let body = '';
  if (message.payload.body?.data) {
    body = decodeBase64Url(message.payload.body.data);
  } else if (message.payload.parts) {
    const plain = message.payload.parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
    const html = message.payload.parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
    if (plain?.body?.data) body = decodeBase64Url(plain.body.data);
    else if (html?.body?.data) body = decodeBase64Url(html.body.data).replace(/<[^>]+>/g, ' ');
  }
  // Trim long bodies for the LLM
  body = body.replace(/\s+/g, ' ').slice(0, 4000);
  return { subject, from, body };
}

async function extractReceipt(subject: string, from: string, body: string): Promise<ReceiptExtraction | null> {
  if (!claudeAvailable()) return null;
  const prompt = `Extract receipt fields from this email.

From: ${from}
Subject: ${subject}
Body:
${body}

Output JSON ONLY:
{
  "is_receipt": true|false,
  "vendor": "<store/service name>" | null,
  "amount": <total in USD, e.g. 24.99> | null,
  "txn_date": "YYYY-MM-DD" | null,
  "category": "food|gas|supplements|athlete-fees|rent|software|travel|gym-equipment|office|medical|other" | null,
  "memo": "short note (under 200 chars)" | null,
  "is_business_likely": true|false|null
}

Rules:
- is_receipt=true for: merchant receipts/order confirmations AND credit-card
  charge alerts (e.g. "A transaction of $24.99 at Trader Joe's was approved").
  These represent real spending and should land in the ledger.
- is_receipt=false if this is a shipping update, password reset, marketing,
  newsletter, statement notification ("your statement is ready"), monthly
  summary, payment due reminder, or anything that isn't a single
  payment/charge event.
- amount = single charge amount (not statement balance or shipping/tax lines).
- txn_date from the charge/receipt date; if missing, leave null.
- vendor = the merchant where the money was spent, NOT the bank/card issuer.
  e.g. for "Chase alert: $20 at Shell", vendor is "Shell" not "Chase".`;
  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 400,
      system: 'You extract structured receipt data from emails. Output JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block?.type !== 'text') return null;
    const s = block.text.indexOf('{');
    const e = block.text.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    const parsed = ReceiptExtraction.parse(JSON.parse(block.text.slice(s, e + 1)));
    return parsed;
  } catch (err) {
    console.error('[gmailScan.extractReceipt] failed:', (err as Error).message);
    return null;
  }
}

export type GmailScanResult = {
  scanned: number;
  receipts_found: number;
  inserted: number;
  duplicates: number;
  errors: string[];
};

export async function runGmailScan(sinceHours = 24): Promise<GmailScanResult> {
  const result: GmailScanResult = { scanned: 0, receipts_found: 0, inserted: 0, duplicates: 0, errors: [] };

  const accessToken = await getAccessToken();
  const candidates = await listCandidateMessages(accessToken, sinceHours);
  result.scanned = candidates.length;

  for (const meta of candidates) {
    try {
      // Dedup by gmail message id stored in raw_parse.gmail_id
      const { data: existing } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', USER_ID)
        .filter('raw_parse->>gmail_id', 'eq', meta.id)
        .maybeSingle();
      if (existing) {
        result.duplicates++;
        continue;
      }

      const message = await fetchMessage(accessToken, meta.id);
      const { subject, from, body } = extractMessageText(message);
      const extraction = await extractReceipt(subject, from, body);
      if (!extraction || !extraction.is_receipt || !extraction.amount || !extraction.vendor) continue;
      result.receipts_found++;

      const txnDate = extraction.txn_date || new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('transactions').insert({
        user_id: USER_ID,
        txn_date: txnDate,
        amount: extraction.amount,
        vendor: extraction.vendor,
        category: extraction.category || null,
        memo: extraction.memo || null,
        is_business: extraction.is_business_likely ?? false,
        source: 'gmail',
        raw_parse: { gmail_id: meta.id, subject, from, extraction } as unknown as Record<string, unknown>,
        needs_review: true,
      });
      if (error) {
        result.errors.push(`${meta.id}: ${error.message}`);
        continue;
      }
      result.inserted++;
    } catch (err) {
      result.errors.push(`${meta.id}: ${(err as Error).message}`);
    }
  }

  return result;
}
