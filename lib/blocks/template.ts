// Weekly time-block template — ported from command-center/backend/blocks.js.
// Block types map to task categories:
//   'deep-thinking', 'deep-admin', 'multitask-admin', 'meeting'  → task-eligible
//   'coaching', 'personal'                                        → LOCKED, never replaced
//   'flex'                                                        → can host deep-thinking OR deep-admin tasks

export type BlockType = 'deep-thinking' | 'deep-admin' | 'multitask-admin' | 'meeting' | 'coaching' | 'personal' | 'flex';
export type BlockEnergy = 'high' | 'med' | 'low';
export type WeekLabel = 'A' | 'B';

export type BlockTemplate = {
  day: number; // 0=Sun .. 6=Sat
  start: string; // 'HH:MM' 24h
  end: string; // 'HH:MM' 24h
  name: string;
  type: BlockType;
  energy?: BlockEnergy;
  locked?: boolean;
};

const STATIC_BLOCKS: BlockTemplate[] = [
  // ─── MONDAY (1) ───
  { day: 1, start: '05:40', end: '05:55', name: 'Transit to Odyssey',     type: 'personal',        locked: true },
  { day: 1, start: '06:00', end: '07:15', name: 'Elite Group Coaching',   type: 'coaching',        locked: true },
  { day: 1, start: '07:30', end: '08:30', name: 'Lauren Feiler',          type: 'coaching',        locked: true },
  { day: 1, start: '08:30', end: '09:30', name: 'Workout Block',          type: 'personal',        locked: true },
  { day: 1, start: '09:30', end: '10:15', name: 'Deep Admin',             type: 'deep-admin',      energy: 'med' },
  { day: 1, start: '10:15', end: '11:00', name: 'Transit Home / Buffer',  type: 'personal',        locked: true },
  { day: 1, start: '11:15', end: '12:00', name: 'OTA Meeting / Admin',    type: 'multitask-admin', energy: 'low' },
  { day: 1, start: '12:00', end: '13:40', name: 'Deep Thinking (2x)',     type: 'deep-thinking',   energy: 'high' },
  { day: 1, start: '13:50', end: '14:20', name: 'Deep Admin',             type: 'deep-admin',      energy: 'med' },
  { day: 1, start: '15:00', end: '15:15', name: 'Transit to Odyssey',     type: 'personal',        locked: true },
  { day: 1, start: '15:15', end: '15:30', name: 'Annie Meeting',          type: 'meeting',         locked: true },
  { day: 1, start: '15:40', end: '17:00', name: 'Gym Maintenance',        type: 'multitask-admin', energy: 'low' },
  { day: 1, start: '17:00', end: '20:00', name: 'Sacred Floor Time',      type: 'coaching',        locked: true },

  // ─── THURSDAY (4) ───
  { day: 4, start: '05:30', end: '06:30', name: 'Workout Block',          type: 'personal',        locked: true },
  { day: 4, start: '06:45', end: '08:25', name: 'Deep Thinking (2x)',     type: 'deep-thinking',   energy: 'high' },
  { day: 4, start: '08:35', end: '09:55', name: 'Deep Admin (2x)',        type: 'deep-admin',      energy: 'med' },
  { day: 4, start: '10:05', end: '11:00', name: 'Planning / Treadmill',   type: 'multitask-admin', energy: 'low' },
  { day: 4, start: '11:15', end: '12:45', name: 'Home Fuel / Reset',      type: 'personal',        locked: true },
  { day: 4, start: '13:00', end: '15:00', name: 'Tri-City Session',       type: 'coaching',        locked: true },
  { day: 4, start: '15:15', end: '15:30', name: 'Annie Meeting',          type: 'meeting',         locked: true },
  { day: 4, start: '17:00', end: '20:00', name: 'Sacred Floor Time',      type: 'coaching',        locked: true },

  // ─── FRIDAY (5) ───
  { day: 5, start: '05:45', end: '06:00', name: 'Gym Setup',              type: 'multitask-admin', energy: 'low' },
  { day: 5, start: '06:00', end: '07:15', name: 'SM Softball Coaching',   type: 'coaching',        locked: true },
  { day: 5, start: '07:30', end: '09:00', name: 'Workout Block',          type: 'personal',        locked: true },
  { day: 5, start: '09:00', end: '10:30', name: 'Deep Thinking',          type: 'deep-thinking',   energy: 'high' },
  { day: 5, start: '12:00', end: '14:00', name: 'Deep Thinking',          type: 'deep-thinking',   energy: 'med' },

  // ─── SATURDAY (6) ───
  { day: 6, start: '10:00', end: '11:30', name: 'Strategy & Ops Cleanup', type: 'flex',            energy: 'med' },

  // ─── SUNDAY (0) ───
  { day: 0, start: '06:30', end: '08:00', name: 'Meal Prep & Planning',   type: 'personal',        locked: true },
  { day: 0, start: '08:00', end: '09:00', name: 'Cohen Mugford',          type: 'coaching',        locked: true },
];

const TUESDAY_WEEK_A: BlockTemplate[] = [
  { day: 2, start: '05:30', end: '06:30', name: 'Workout Block',           type: 'personal',        locked: true },
  { day: 2, start: '06:45', end: '08:25', name: 'Deep Thinking (2x)',      type: 'deep-thinking',   energy: 'high' },
  { day: 2, start: '08:35', end: '09:55', name: 'Deep Admin (2x)',         type: 'deep-admin',      energy: 'med' },
  { day: 2, start: '10:05', end: '11:00', name: 'Planning / Treadmill',    type: 'multitask-admin', energy: 'low' },
  { day: 2, start: '11:45', end: '12:45', name: 'Admin / Execution',       type: 'multitask-admin', energy: 'low' },
  { day: 2, start: '13:00', end: '15:00', name: 'Tri-City Session',        type: 'coaching',        locked: true },
  { day: 2, start: '15:15', end: '15:30', name: 'Annie Meeting',           type: 'meeting',         locked: true },
  { day: 2, start: '15:40', end: '17:00', name: 'Multi-Task Admin',        type: 'multitask-admin', energy: 'low' },
];

const TUESDAY_WEEK_B: BlockTemplate[] = [
  { day: 2, start: '05:30', end: '06:30', name: 'Workout Block',           type: 'personal',        locked: true },
  { day: 2, start: '06:45', end: '08:25', name: 'Deep Thinking (2x)',      type: 'deep-thinking',   energy: 'high' },
  { day: 2, start: '08:35', end: '09:55', name: 'Deep Admin (2x)',         type: 'deep-admin',      energy: 'med' },
  { day: 2, start: '10:05', end: '11:00', name: 'Planning / Treadmill',    type: 'multitask-admin', energy: 'low' },
  { day: 2, start: '11:45', end: '12:45', name: 'Gabby Session',           type: 'coaching',        locked: true },
  { day: 2, start: '13:00', end: '15:00', name: 'Tri-City Session',        type: 'coaching',        locked: true },
  { day: 2, start: '15:15', end: '15:30', name: 'Annie Meeting',           type: 'meeting',         locked: true },
  { day: 2, start: '15:40', end: '17:00', name: 'Multi-Task Admin',        type: 'multitask-admin', energy: 'low' },
];

const WEDNESDAY_WEEK_A: BlockTemplate[] = [
  { day: 3, start: '04:30', end: '06:10', name: 'Deep Thinking (2x)',      type: 'deep-thinking',   energy: 'high' },
  { day: 3, start: '06:20', end: '07:20', name: 'Deep Admin',              type: 'deep-admin',      energy: 'med' },
  { day: 3, start: '07:30', end: '09:00', name: 'Workout Block',           type: 'personal',        locked: true },
  { day: 3, start: '10:00', end: '11:00', name: 'OTA Meeting',             type: 'multitask-admin', energy: 'low' },
  { day: 3, start: '11:10', end: '11:50', name: 'Deep Admin',              type: 'deep-admin',      energy: 'med' },
  { day: 3, start: '12:00', end: '13:00', name: 'Sacred Nap',              type: 'personal',        locked: true },
  { day: 3, start: '13:45', end: '14:45', name: 'Gabby Session',           type: 'coaching',        locked: true },
  { day: 3, start: '15:00', end: '15:30', name: 'Coaches Meeting',         type: 'meeting',         locked: true },
  { day: 3, start: '17:00', end: '20:00', name: 'Sacred Floor Time',       type: 'coaching',        locked: true },
];

const WEDNESDAY_WEEK_B: BlockTemplate[] = [
  { day: 3, start: '04:30', end: '06:10', name: 'Deep Thinking (2x)',      type: 'deep-thinking',   energy: 'high' },
  { day: 3, start: '06:20', end: '07:20', name: 'Deep Admin',              type: 'deep-admin',      energy: 'med' },
  { day: 3, start: '07:30', end: '09:00', name: 'Workout Block',           type: 'personal',        locked: true },
  { day: 3, start: '10:00', end: '11:00', name: 'OTA Meeting',             type: 'multitask-admin', energy: 'low' },
  { day: 3, start: '11:10', end: '11:50', name: 'Deep Admin',              type: 'deep-admin',      energy: 'med' },
  { day: 3, start: '12:00', end: '13:00', name: 'Sacred Nap',              type: 'personal',        locked: true },
  { day: 3, start: '13:45', end: '14:45', name: 'Deep Admin / Backlog',    type: 'deep-admin',      energy: 'med' },
  { day: 3, start: '15:00', end: '15:30', name: 'Coaches Meeting',         type: 'meeting',         locked: true },
  { day: 3, start: '17:00', end: '20:00', name: 'Sacred Floor Time',       type: 'coaching',        locked: true },
];

const DAY_PREFIX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Deterministic block ID: e.g. "MON-09:30" — stable across recalcs. */
export function blockId(b: BlockTemplate): string {
  return `${DAY_PREFIX[b.day]}-${b.start}`;
}

/** Full block list for a given week label, sorted day asc → start asc. */
export function blocksForWeek(label: WeekLabel): BlockTemplate[] {
  const tue = label === 'B' ? TUESDAY_WEEK_B : TUESDAY_WEEK_A;
  const wed = label === 'B' ? WEDNESDAY_WEEK_B : WEDNESDAY_WEEK_A;
  return [...STATIC_BLOCKS, ...tue, ...wed].sort(
    (a, b) => a.day - b.day || a.start.localeCompare(b.start),
  );
}

/** Get a single block by ID for the given week, or null. */
export function findBlock(label: WeekLabel, id: string): BlockTemplate | null {
  return blocksForWeek(label).find((b) => blockId(b) === id) || null;
}

/** Compute the Monday (00:00 local time) of the week containing `date`. */
export function mondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offsetToMon);
  return d;
}

/** Convert a BlockTemplate to an actual Date range for the week starting at weekStart (a Monday). */
export function blockDates(block: BlockTemplate, weekStart: Date): { start: Date; end: Date } {
  // Monday=1 in our template; weekStart is a Monday. Offset from Monday:
  // template day 1 (Mon) → offset 0, 2 → 1, ..., 0 (Sun) → 6
  const offset = (block.day + 6) % 7;
  const date = new Date(weekStart);
  date.setDate(date.getDate() + offset);
  const [sh, sm] = block.start.split(':').map(Number);
  const [eh, em] = block.end.split(':').map(Number);
  const start = new Date(date);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(date);
  end.setHours(eh, em, 0, 0);
  return { start, end };
}

/** Block duration in minutes. */
export function blockMinutes(block: BlockTemplate): number {
  const [sh, sm] = block.start.split(':').map(Number);
  const [eh, em] = block.end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

export const TYPE_EMOJI: Record<BlockType, string> = {
  'deep-thinking': '🔵',
  'deep-admin': '🟡',
  'multitask-admin': '🟠',
  'meeting': '🟢',
  'coaching': '⚫',
  'personal': '⚪',
  'flex': '🔵',
};

// Google Calendar color IDs by block type
export const TYPE_GCAL_COLOR: Record<BlockType, string> = {
  'deep-thinking': '9',  // Blueberry
  'deep-admin': '5',     // Banana
  'multitask-admin': '6', // Tangerine
  'meeting': '10',       // Basil
  'coaching': '8',       // Graphite
  'personal': '1',       // Lavender
  'flex': '7',           // Peacock
};

export const DAY_LABELS = DAY_PREFIX;
