const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function api(): string {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return `https://api.telegram.org/bot${BOT_TOKEN}`;
}

function fileApi(): string {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return `https://api.telegram.org/file/bot${BOT_TOKEN}`;
}

export async function sendMessage(chatId: number, text: string, opts?: {
  reply_to_message_id?: number;
  reply_markup?: Record<string, unknown>;
}): Promise<void> {
  const res = await fetch(`${api()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...opts,
    }),
  });
  if (!res.ok) {
    console.error('[telegram.sendMessage] failed:', res.status, await res.text());
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`${api()}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {});
}

export async function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  reply_markup: Record<string, unknown> | null,
): Promise<void> {
  await fetch(`${api()}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup }),
  }).catch(() => {});
}

/** Download a Telegram voice file by file_id; returns the raw bytes. */
export async function downloadFile(fileId: string): Promise<{ bytes: ArrayBuffer; path: string } | null> {
  const meta = await fetch(`${api()}/getFile?file_id=${fileId}`).then((r) => r.json());
  if (!meta?.ok || !meta?.result?.file_path) {
    console.error('[telegram.downloadFile] getFile failed:', meta);
    return null;
  }
  const path = meta.result.file_path as string;
  const dl = await fetch(`${fileApi()}/${path}`);
  if (!dl.ok) {
    console.error('[telegram.downloadFile] download failed:', dl.status);
    return null;
  }
  return { bytes: await dl.arrayBuffer(), path };
}

export type UrgencyChoice = 'today' | 'this_week' | 'this_month' | 'someday' | 'key';
export type CategoryChoice = 'deep-thinking' | 'deep-admin' | 'multitask-admin' | 'meeting' | 'personal' | 'flex';

const CATEGORY_LABELS: Record<CategoryChoice, string> = {
  'deep-thinking': 'Think',
  'deep-admin': 'Admin',
  'multitask-admin': 'Multi',
  'meeting': 'Meet',
  'personal': 'Personal',
  'flex': 'Flex',
};

/** Inline keyboard with urgency overrides + category overrides for a captured task. */
export function taskKeyboard(taskId: string, currentCategory: string | null): Record<string, unknown> {
  const urg = (label: string, choice: UrgencyChoice) => ({
    text: label,
    callback_data: `urgency:${taskId}:${choice}`,
  });
  const cat = (choice: CategoryChoice) => ({
    text: currentCategory === choice ? `✓ ${CATEGORY_LABELS[choice]}` : CATEGORY_LABELS[choice],
    callback_data: `category:${taskId}:${choice}`,
  });
  return {
    inline_keyboard: [
      [urg('Today', 'today'), urg('Week', 'this_week')],
      [urg('Month', 'this_month'), urg('Someday', 'someday'), urg('★ Key', 'key')],
      [cat('deep-thinking'), cat('deep-admin'), cat('multitask-admin')],
      [cat('meeting'), cat('personal'), cat('flex')],
    ],
  };
}

/** Inline keyboard for urgency override after a capture. */
export function urgencyKeyboard(taskId: string): Record<string, unknown> {
  const row = (label: string, choice: UrgencyChoice) => ({
    text: label,
    callback_data: `urgency:${taskId}:${choice}`,
  });
  return {
    inline_keyboard: [
      [row('Today', 'today'), row('Week', 'this_week')],
      [row('Month', 'this_month'), row('Someday', 'someday')],
      [row('★ Key', 'key')],
    ],
  };
}
