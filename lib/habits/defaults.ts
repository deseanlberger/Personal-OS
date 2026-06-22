// Habit definitions for Desean.
//
// Each habit has:
//   cadence: 'daily' (resets midnight)  or  'weekly' (resets Monday morning)
//   measure: 'count' (1, 2, 3...) or 'minutes' (time accumulator)
//   target:  goal value
//   step:    increment added per tap
//   unit:    short label ('oz', 'min', 'days')
//
// Storage: daily_logs.notes.habits.entries = { habit_id: number_for_that_day }
// Weekly habits aggregate across the last 7 days (Mon-anchored week).

export type HabitCategory = 'body' | 'mind' | 'rest' | 'connection';
export type HabitCadence = 'daily' | 'weekly';
export type HabitMeasure = 'count' | 'minutes';

export type HabitDef = {
  id: string;
  label: string;
  category: HabitCategory;
  cadence: HabitCadence;
  measure: HabitMeasure;
  target: number;
  step: number;
  unit: string;
  sub?: string;
};

export const DEFAULT_HABITS: HabitDef[] = [
  {
    id: 'workout',
    label: 'Workouts',
    category: 'body',
    cadence: 'weekly',
    measure: 'count',
    target: 4,
    step: 1,
    unit: 'days',
    sub: '4×/week',
  },
  {
    id: 'water',
    label: 'Water',
    category: 'body',
    cadence: 'daily',
    measure: 'count',
    target: 160,
    step: 16,
    unit: 'oz',
    sub: '160oz/day · +16 per tap',
  },
  {
    id: 'deep-work-programming',
    label: 'Deep work — programming',
    category: 'mind',
    cadence: 'daily',
    measure: 'minutes',
    target: 45,
    step: 15,
    unit: 'min',
    sub: '45min/day · +15 per tap',
  },
  {
    id: 'business-skill',
    label: 'Learn business skill',
    category: 'mind',
    cadence: 'weekly',
    measure: 'minutes',
    target: 120,
    step: 30,
    unit: 'min',
    sub: '2hr/week · +30 per tap',
  },
  {
    id: 'chest-workout',
    label: 'Chest sesh',
    category: 'body',
    cadence: 'weekly',
    measure: 'count',
    target: 3,
    step: 1,
    unit: 'days',
    sub: '3×/week · bench 5×10 + DB bench 5×10 + cable fly 4×12',
  },
];

export const CATEGORY_TONE: Record<HabitCategory, string> = {
  body: 'bg-emerald-400/80',
  mind: 'bg-blue-400/80',
  rest: 'bg-purple-400/80',
  connection: 'bg-amber-400/80',
};
