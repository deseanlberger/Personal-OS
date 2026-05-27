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
import { localDateKey } from '@/lib/habits/date';
import { recalcWeek } from '@/lib/blocks/recalc';

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

  // PHOTO path → estimate macros + log as a meal
  if (msg.photo && msg.photo.length > 0) {
    await handleFoodPhoto(msg);
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
};

const USER_ID = process.env.USER_ID || 'desean';

async function handleFoodPhoto(msg: NonNullable<TelegramUpdate['message']>): Promise<void> {
  const chatId = msg.chat.id;
  // Pick the largest photo size for best classification
  const photo = msg.photo![msg.photo!.length - 1];
  const dl = await downloadFile(photo.file_id);
  if (!dl) {
    await sendMessage(chatId, 'Apologies, sir — could not download the photo.');
    return;
  }
  // Convert ArrayBuffer → base64 → data URI for OpenAI vision
  const bytes = new Uint8Array(dl.bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const ext = dl.path.split('.').pop()?.toLowerCase() || 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUri = `data:${mime};base64,${b64}`;

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
    return `*Logged, sir.* → tasks · ${urgencyHuman[c.urgency] || c.urgency}\n${c.summary}\n_${slot}${energy}${time}_${tagsLine}\n\nTap to adjust urgency or category if I misjudged.`;
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
