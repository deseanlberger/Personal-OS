import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { routeCapture } from '@/lib/router/routeCapture';
import {
  sendMessage,
  downloadFile,
  answerCallbackQuery,
  editMessageReplyMarkup,
  taskKeyboard,
} from '@/lib/telegram/api';
import { transcribeAudio } from '@/lib/llm/whisper';
import { estimateMacrosFromImage } from '@/lib/nutrition/estimator';
import { classifyPhotoKind, parseReceiptFromImage } from '@/lib/finance/receiptParser';
import { localDateKey } from '@/lib/habits/date';
import { recalcWeek } from '@/lib/blocks/recalc';
import { extractUrl, saveLink } from '@/lib/links/save';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const URGENCY_CHOICES = new Set(['today', 'this_week', 'this_month', 'someday']);
const CATEGORY_CHOICES = new Set([
  'deep-thinking',
  'deep-admin',
  'multitask-admin',
  'meeting',
  'personal',
  'flex',
]);

type TelegramPhoto = { file_id: string; width: number; height: number; file_size?: number };

type TelegramUpdate = {
  message?: {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    caption?: string;
    voice?: { file_id: string; mime_type?: string };
    photo?: TelegramPhoto[];     // sizes ascending
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
};

export async function POST(req: NextRequest) {
  // 1. Verify Telegram secret header
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const headerSecret = req.headers.get(SECRET_HEADER);
  if (!expectedSecret || headerSecret !== expectedSecret) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  // 2. Verify sender is Desean (allowlist)
  const expectedUserId = process.env.TELEGRAM_USER_ID;
  const fromId = update.message?.from?.id || update.callback_query?.from?.id;
  if (!expectedUserId || String(fromId) !== expectedUserId) {
    console.warn('[telegram] rejected message from unauthorized user', fromId);
    return NextResponse.json({ ok: true });
  }

  // 3. Handle callback queries (urgency override taps)
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  // 4. Handle messages (text or voice)
  if (update.message) {
    await handleMessage(update.message);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: NonNullable<TelegramUpdate['message']>): Promise<void> {
  const chatId = msg.chat.id;

  // PHOTO path → classify (food vs receipt) then route to the right parser.
  if (msg.photo && msg.photo.length > 0) {
    await handlePhoto(msg);
    return;
  }

  let text: string | null = msg.text ?? null;
  let audioUrl: string | null = null;

  // Handle Telegram bot commands (/start, /help, /status, /ping) — don't classify, just acknowledge.
  if (text && text.startsWith('/')) {
    const cmd = text.split(/\s+/)[0].toLowerCase();
    if (cmd === '/start') {
      await sendMessage(chatId, 'Online and standing by, sir. Send a thought, task, or voice note and I will route it.');
      return;
    }
    if (cmd === '/help') {
      await sendMessage(chatId, '*Operating manual, sir:*\n\nSend any text or voice note. I will classify it and route to your dashboard.\n\nOnce I tag a task, tap one of the urgency buttons to override my guess.\n\n_/status_ — shows last classification\n_/ping_ — connectivity check', {});
      return;
    }
    if (cmd === '/ping') {
      await sendMessage(chatId, 'Affirmative, sir. All systems nominal.');
      return;
    }
    // Unknown command — silently ignore (don't pollute capture log)
    return;
  }

  // If voice: download, transcribe
  if (msg.voice?.file_id) {
    const dl = await downloadFile(msg.voice.file_id);
    if (!dl) {
      await sendMessage(chatId, 'My apologies, sir — I could not download that voice note.');
      return;
    }
    audioUrl = `telegram://${msg.voice.file_id}`;
    const ext = dl.path.split('.').pop() || 'ogg';
    const transcript = await transcribeAudio(dl.bytes, `voice.${ext}`);
    if (!transcript) {
      await sendMessage(chatId, 'My apologies, sir — the transcription failed.');
      return;
    }
    text = transcript;
  }

  if (!text || text.trim().length === 0) {
    return;
  }

  // URL detection — if the message body contains a link, file it in /library
  // instead of running the task classifier.
  const detectedUrl = extractUrl(text);
  if (detectedUrl) {
    try {
      const link = await saveLink(detectedUrl);
      if (link) {
        const cat = link.category ? `_${link.category}_` : '';
        await sendMessage(
          chatId,
          `*Saved to Library, sir.*\n${link.title || link.url}\n${cat}${link.summary ? `\n\n${link.summary}` : ''}\n\nView all at /library.`,
          { reply_to_message_id: msg.message_id },
        );
      } else {
        await sendMessage(
          chatId,
          `Apologies, sir — I could not save that link.`,
          { reply_to_message_id: msg.message_id },
        );
      }
    } catch (err) {
      console.error('[telegram] saveLink failed:', err);
      await sendMessage(
        chatId,
        `Apologies, sir — link save failed: ${(err as Error).message}`,
        { reply_to_message_id: msg.message_id },
      );
    }
    return;
  }

  try {
    const result = await routeCapture({ text, source: 'telegram', audio_url: audioUrl });

    const c = result.classification;
    const reply = jarvisReply(c, result.routed_to);

    await sendMessage(chatId, reply, {
      reply_to_message_id: msg.message_id,
      reply_markup: result.routed_id
        ? taskKeyboard(result.routed_id, c.category)
        : undefined,
    });
  } catch (err) {
    console.error('[telegram.handleMessage] capture failed:', err);
    await sendMessage(chatId, `Apologies, sir — capture failed: ${(err as Error).message}`);
  }
}

type Classification = {
  kind: string;
  urgency: string;
  category: string | null;
  energy: string | null;
  estimated_minutes: number | null;
  tags: string[];
  summary: string;
  confidence?: number;
};

const LOW_CONFIDENCE_THRESHOLD = 0.6;

const USER_ID = process.env.USER_ID || 'desean';

/**
 * Downloads the largest photo size and converts to a base64 data URI suitable
 * for OpenAI vision endpoints. Returns null on failure.
 */
async function downloadPhotoAsDataUri(
  msg: NonNullable<TelegramUpdate['message']>,
): Promise<string | null> {
  const photo = msg.photo![msg.photo!.length - 1];
  const dl = await downloadFile(photo.file_id);
  if (!dl) return null;
  const bytes = new Uint8Array(dl.bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const ext = dl.path.split('.').pop()?.toLowerCase() || 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

/** Routes a photo to either receipt or food parsing based on a quick vision classification. */
async function handlePhoto(msg: NonNullable<TelegramUpdate['message']>): Promise<void> {
  const chatId = msg.chat.id;
  const dataUri = await downloadPhotoAsDataUri(msg);
  if (!dataUri) {
    await sendMessage(chatId, 'Apologies, sir — could not download the photo.');
    return;
  }

  // Caption can force a route (e.g. "receipt" / "food").
  const caption = (msg.caption || '').toLowerCase();
  let kind: 'receipt' | 'food' | 'other';
  if (caption.includes('receipt') || caption.includes('bill') || caption.includes('invoice')) {
    kind = 'receipt';
  } else if (caption.includes('food') || caption.includes('meal') || caption.includes('eat')) {
    kind = 'food';
  } else {
    kind = await classifyPhotoKind(dataUri);
  }

  if (kind === 'receipt') {
    await handleReceiptPhoto(msg, dataUri);
  } else if (kind === 'food') {
    await handleFoodPhoto(msg, dataUri);
  } else {
    await sendMessage(
      chatId,
      'I could not tell what this photo is, sir. Try a clearer shot of a receipt or meal — or add a caption.',
      { reply_to_message_id: msg.message_id },
    );
  }
}

async function handleReceiptPhoto(
  msg: NonNullable<TelegramUpdate['message']>,
  dataUri: string,
): Promise<void> {
  const chatId = msg.chat.id;
  const parsed = await parseReceiptFromImage(dataUri);
  if (!parsed) {
    await sendMessage(
      chatId,
      'Apologies, sir — I could not parse that receipt. Try a clearer shot.',
      { reply_to_message_id: msg.message_id },
    );
    return;
  }

  const { error } = await supabase.from('transactions').insert({
    user_id: USER_ID,
    txn_date: parsed.txn_date,
    amount: parsed.amount,
    vendor: parsed.vendor,
    category: parsed.category || null,
    memo: parsed.memo || null,
    is_business: parsed.is_business_likely ?? false,
    source: 'photo',
    raw_parse: parsed as unknown as Record<string, unknown>,
    needs_review: true,
  });

  if (error) {
    console.error('[telegram.handleReceiptPhoto] insert failed:', error.message);
    await sendMessage(
      chatId,
      `Apologies, sir — the receipt parsed but failed to save: ${error.message}`,
      { reply_to_message_id: msg.message_id },
    );
    return;
  }

  await sendMessage(
    chatId,
    `*Receipt logged, sir.*\n${parsed.vendor} — *$${parsed.amount.toFixed(2)}* · ${parsed.txn_date}${parsed.category ? `\n_${parsed.category}_` : ''}\n\nReview + assign account on /finance.`,
    { reply_to_message_id: msg.message_id },
  );
}

async function handleFoodPhoto(
  msg: NonNullable<TelegramUpdate['message']>,
  preFetchedDataUri?: string,
): Promise<void> {
  const chatId = msg.chat.id;
  let dataUri = preFetchedDataUri ?? null;
  if (!dataUri) {
    dataUri = await downloadPhotoAsDataUri(msg);
    if (!dataUri) {
      await sendMessage(chatId, 'Apologies, sir — could not download the photo.');
      return;
    }
  }

  const macro = await estimateMacrosFromImage(dataUri);
  if (!macro) {
    await sendMessage(chatId, 'Apologies, sir — I could not read that photo. Try a clearer shot of the plate.');
    return;
  }

  // Log as a meal for today
  const today = localDateKey();
  const { data: existing } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', today)
    .maybeSingle();

  type Notes = { nutrition?: { meals: Array<Record<string, unknown>>; updated_at?: string }; [k: string]: unknown };
  let notes: Notes = {};
  try { notes = JSON.parse(existing?.notes || '{}'); } catch {}

  const meals = [...(notes.nutrition?.meals || [])];
  meals.push({
    id: crypto.randomUUID(),
    t: new Date().toISOString(),
    name: macro.name,
    kcal: macro.kcal,
    p: macro.p,
    c: macro.c,
    f: macro.f,
    source: 'photo',
    notes: macro.notes,
  });
  notes.nutrition = { meals, updated_at: new Date().toISOString() };

  await supabase
    .from('daily_logs')
    .upsert(
      {
        user_id: USER_ID,
        log_date: today,
        notes: JSON.stringify(notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,log_date' },
    );

  // Compute today's running totals to reply with
  const totals = meals.reduce(
    (a: { kcal: number; p: number; c: number; f: number }, m: Record<string, unknown>) => ({
      kcal: a.kcal + (Number(m.kcal) || 0),
      p: a.p + (Number(m.p) || 0),
      c: a.c + (Number(m.c) || 0),
      f: a.f + (Number(m.f) || 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );

  await sendMessage(
    chatId,
    `*Logged from photo, sir.*\n${macro.name} — *${macro.kcal} kcal* · ${Math.round(macro.p)}p · ${Math.round(macro.c)}c · ${Math.round(macro.f)}f${macro.notes ? `\n_${macro.notes}_` : ''}\n\nToday so far: *${totals.kcal} kcal* · ${Math.round(totals.p)}p · ${Math.round(totals.c)}c · ${Math.round(totals.f)}f`,
    { reply_to_message_id: msg.message_id },
  );
}

function jarvisReply(c: Classification, routedTo: 'tasks' | null): string {
  const urgencyHuman: Record<string, string> = {
    today: 'today',
    this_week: 'this week',
    this_month: 'this month',
    someday: 'someday',
  };

  const tagsLine = c.tags.length ? `\n_${c.tags.map((t) => `#${t}`).join(' ')}_` : '';

  // For tasks/decisions, tell user where it went + offer override
  if (routedTo === 'tasks') {
    const slot = c.category ? `${c.category}` : 'general';
    const energy = c.energy ? ` · ${c.energy} energy` : '';
    const time = c.estimated_minutes ? ` · ~${c.estimated_minutes}m` : '';
    const confidence = typeof c.confidence === 'number' ? c.confidence : 0.8;
    const uncertain = confidence < LOW_CONFIDENCE_THRESHOLD;
    const footer = uncertain
      ? `\n\n⚠️ *I'm not sure about this one (${Math.round(confidence * 100)}% confident).* Pick the right category below, sir.`
      : `\n\nTap to adjust urgency or category if I misjudged.`;
    return `*Logged, sir.* → tasks · ${urgencyHuman[c.urgency] || c.urgency}\n${c.summary}\n_${slot}${energy}${time}_${tagsLine}${footer}`;
  }

  // For non-task captures (notes, journals, decisions)
  const kindHuman: Record<string, string> = {
    note: 'Noted, sir',
    journal: 'Recorded, sir',
    decision: 'Decision logged, sir',
    capture: 'Captured, sir',
  };
  return `*${kindHuman[c.kind] || 'Captured, sir'}.*\n${c.summary}${tagsLine}`;
}

async function handleCallback(cb: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
  const data = cb.data || '';
  const parts = data.split(':'); // <kind>:<task_id>:<choice>
  if (parts.length !== 3) {
    await answerCallbackQuery(cb.id);
    return;
  }
  const [kind, taskId, choice] = parts;

  if (kind === 'urgency') {
    if (choice === 'key') {
      await supabase.from('tasks').update({ key: true }).eq('id', taskId);
      await answerCallbackQuery(cb.id, '★ Marked key');
    } else if (URGENCY_CHOICES.has(choice)) {
      await supabase.from('tasks').update({ urgency: choice }).eq('id', taskId);
      await answerCallbackQuery(cb.id, `→ ${choice.replace('_', ' ')}`);
    } else {
      await answerCallbackQuery(cb.id);
    }
    // Urgency taps don't change the visual keyboard — leave it in place so Desean
    // can still tap a category afterwards.
    return;
  }

  if (kind === 'category') {
    if (!CATEGORY_CHOICES.has(choice)) {
      await answerCallbackQuery(cb.id);
      return;
    }
    await supabase.from('tasks').update({ category: choice }).eq('id', taskId);
    await answerCallbackQuery(cb.id, `→ ${choice}`);

    // Rebuild the keyboard with the new ✓ marker so the user sees the change reflected.
    if (cb.message) {
      await editMessageReplyMarkup(
        cb.message.chat.id,
        cb.message.message_id,
        taskKeyboard(taskId, choice),
      );
    }

    // Fire-and-forget: re-run the block engine so the task moves to a matching slot.
    recalcWeek().catch((err) => {
      console.error('[telegram.callback] recalc after category change failed:', err.message);
    });
    return;
  }

  await answerCallbackQuery(cb.id);
}
