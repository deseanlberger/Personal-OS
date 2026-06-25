import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { blocksForWeekFromDb } from '@/lib/blocks/templateStore';
import { getWeekLabel } from '@/lib/app_meta';
import { localDateKey, localClock, USER_TIMEZONE } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

type DailyLogNotes = {
  habits?: { entries?: Record<string, number> };
  nutrition?: { meals?: { kcal: number; p: number }[] };
};

/**
 * GET /api/jarvis/brief
 * Builds a Jarvis-style spoken briefing for right now. Pulls today's blocks,
 * open tasks, current/next block, habit totals, nutrition totals, pending
 * receipts. Hands the structured snapshot to Claude with a Jarvis-voice
 * system prompt and returns the spoken text.
 */
export async function GET() {
  const now = new Date();
  const today = localDateKey();
  const { hour, minute, dayOfWeek } = localClock(now);
  const greeting =
    hour < 5 ? 'Burning the midnight oil, sir' :
    hour < 12 ? 'Good morning, sir' :
    hour < 17 ? 'Good afternoon, sir' :
    hour < 21 ? 'Good evening, sir' :
    'Burning the midnight oil, sir';

  // Pull today's blocks
  const weekLabel = await getWeekLabel();
  const allBlocks = await blocksForWeekFromDb(weekLabel);
  const todayBlocks = allBlocks
    .filter((b) => b.day === dayOfWeek)
    .sort((a, b) => a.start.localeCompare(b.start));

  const nowMin = hour * 60 + minute;
  let currentBlock: typeof todayBlocks[number] | null = null;
  let nextBlock: typeof todayBlocks[number] | null = null;
  for (const b of todayBlocks) {
    const [sh, sm] = b.start.split(':').map(Number);
    const [eh, em] = b.end.split(':').map(Number);
    const s = sh * 60 + sm;
    const e = eh * 60 + em;
    if (s <= nowMin && e > nowMin) currentBlock = b;
    else if (s > nowMin && !nextBlock) nextBlock = b;
  }

  // Open tasks
  const { data: openTasks } = await supabase
    .from('tasks')
    .select('id, title, urgency, key, is_pinned, category, estimated_minutes')
    .eq('user_id', USER_ID)
    .is('completed_at', null)
    .limit(500);
  const totalOpen = openTasks?.length || 0;
  const oneThing = openTasks?.find((t) => t.is_pinned) || openTasks?.find((t) => t.key);
  const todayTasks = openTasks?.filter((t) => t.urgency === 'today') || [];

  // Today's daily_logs (habits + nutrition)
  const { data: dailyLog } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', today)
    .maybeSingle();
  let habitEntries: Record<string, number> = {};
  let kcalToday = 0;
  let proteinToday = 0;
  if (dailyLog?.notes) {
    try {
      const notes = JSON.parse(dailyLog.notes) as DailyLogNotes;
      habitEntries = notes.habits?.entries || {};
      const meals = notes.nutrition?.meals || [];
      kcalToday = meals.reduce((s, m) => s + (m.kcal || 0), 0);
      proteinToday = meals.reduce((s, m) => s + (m.p || 0), 0);
    } catch {
      // ignore
    }
  }

  // Pending receipts
  const { count: pendingCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', USER_ID)
    .eq('needs_review', true);

  // Finance anomalies — categories spending >2x weekly avg
  let topAnomaly: { category: string; ratio: number } | null = null;
  try {
    const cutoff7 = new Date(now);
    cutoff7.setDate(cutoff7.getDate() - 7);
    const cutoff35 = new Date(now);
    cutoff35.setDate(cutoff35.getDate() - 35);
    const { data: anomalyTxns } = await supabase
      .from('transactions')
      .select('txn_date, amount, category')
      .eq('user_id', USER_ID)
      .eq('needs_review', false)
      .gt('amount', 0)
      .gte('txn_date', cutoff35.toISOString().slice(0, 10));
    if (anomalyTxns) {
      const thisW = new Map<string, number>();
      const prior = new Map<string, number>();
      const cut7 = cutoff7.toISOString().slice(0, 10);
      for (const t of anomalyTxns) {
        const cat = t.category || 'uncategorized';
        const amt = Number(t.amount);
        if (t.txn_date >= cut7) thisW.set(cat, (thisW.get(cat) || 0) + amt);
        else prior.set(cat, (prior.get(cat) || 0) + amt);
      }
      let best: { category: string; ratio: number } | null = null;
      for (const [cat, tw] of thisW) {
        const avg = (prior.get(cat) || 0) / 4;
        if (avg < 10 || tw < 25) continue;
        const ratio = tw / avg;
        if (ratio >= 2 && (!best || ratio > best.ratio)) best = { category: cat, ratio: Math.round(ratio * 10) / 10 };
      }
      topAnomaly = best;
    }
  } catch {
    // best-effort
  }

  // Workout context — last bench top-set, last run, did we train today
  const { data: todayWorkouts } = await supabase
    .from('workout_sessions')
    .select('session_type')
    .eq('user_id', USER_ID)
    .eq('session_date', today);
  const didStrengthToday = !!todayWorkouts?.some((w) => w.session_type === 'strength');
  const didRunToday = !!todayWorkouts?.some((w) => w.session_type === 'running');
  const { data: lastBench } = await supabase
    .from('v_strength_pr_trend')
    .select('best_top_weight, session_date')
    .eq('exercise_name', 'Barbell Bench Press')
    .order('session_date', { ascending: false })
    .limit(1);

  // Compose facts for Claude
  const facts = [
    `Time: ${now.toLocaleString('en-US', { timeZone: USER_TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`,
    `Open tasks: ${totalOpen}`,
    `Tasks marked today: ${todayTasks.length}`,
    oneThing ? `One Thing: ${oneThing.title}` : null,
    currentBlock ? `Current block: ${currentBlock.name} (${currentBlock.start}-${currentBlock.end})` : null,
    nextBlock ? `Next block: ${nextBlock.name} at ${nextBlock.start}` : null,
    `Nutrition today: ${Math.round(kcalToday)} kcal, ${Math.round(proteinToday)}g protein`,
    Object.keys(habitEntries).length > 0
      ? `Habits today: ${Object.entries(habitEntries).map(([k, v]) => `${k}=${v}`).join(', ')}`
      : null,
    pendingCount && pendingCount > 0 ? `${pendingCount} receipts awaiting review` : null,
    topAnomaly ? `${topAnomaly.category} spend is ${topAnomaly.ratio}x weekly avg` : null,
    didStrengthToday ? 'Already trained today (strength)' : null,
    didRunToday ? 'Already ran today' : null,
    lastBench && lastBench[0]
      ? `Last bench top-set: ${Number(lastBench[0].best_top_weight).toFixed(0)} lb (${lastBench[0].session_date})`
      : null,
  ].filter(Boolean).join('\n');

  // Fallback when Claude is offline
  if (!claudeAvailable()) {
    const lines = [
      `${greeting}.`,
      currentBlock ? `Currently in ${currentBlock.name}.` : nextBlock ? `Next block is ${nextBlock.name} at ${nextBlock.start}.` : 'Nothing scheduled right now.',
      totalOpen > 0 ? `You have ${totalOpen} open ${totalOpen === 1 ? 'task' : 'tasks'}.` : 'Your task list is clear.',
      oneThing ? `Your one thing: ${oneThing.title}.` : null,
    ].filter(Boolean);
    return NextResponse.json({ text: lines.join(' '), facts });
  }

  const systemPrompt = `You are Jarvis from Iron Man — Desean's personal AI butler. Polite, dry-witted British servant tone. Use "sir" naturally but not in every sentence. Keep the briefing tight: 4-7 sentences, under 600 characters total. No markdown, no headers, just spoken English. Open with the greeting "${greeting}" (sometimes vary slightly). Mention the current or next block by name, the one-thing if there is one, and one or two other notable items (pending receipts, low-confidence habit, big task count). End with a short forward-looking question OR observation. Never use emojis. Numbers should be spoken-style — "fourteen" not "14" — except times (use "9 AM").`;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Today's snapshot:\n${facts}\n\nWrite Desean's spoken briefing.` }],
    });
    const block = msg.content[0];
    const text = block?.type === 'text' ? block.text.trim() : 'Briefing unavailable, sir.';
    return NextResponse.json({ text, facts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
