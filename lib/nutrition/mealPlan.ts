// Desean's prepped meal plan (cut to 190 lb @ 2,417 kcal / 205g protein target).
// Tap "Log today's plan" on the Nutrition card to drop these into today.

export type PlanMeal = {
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  notes?: string;
};

export const DAILY_MEAL_PLAN: PlanMeal[] = [
  { name: 'Salmon (8.3 oz)',           kcal: 491, p: 47, c: 0,   f: 31, notes: 'Prepped portion' },
  { name: 'Ground beef 93/7 (12.8 oz)', kcal: 554, p: 77, c: 0,   f: 26, notes: 'Prepped portion' },
  { name: 'Rice (~2.4 cups cooked)',   kcal: 540, p: 10, c: 118, f: 1,  notes: 'From dry prep' },
  { name: 'Yogurt (2 cups)',            kcal: 300, p: 40, c: 14,  f: 6,  notes: '~20g protein/cup avg' },
  { name: 'Premier Protein shake',      kcal: 160, p: 30, c: 4,   f: 3 },
];

export const PLAN_TOTALS = DAILY_MEAL_PLAN.reduce(
  (a, m) => ({
    kcal: a.kcal + m.kcal,
    p: a.p + m.p,
    c: a.c + m.c,
    f: a.f + m.f,
  }),
  { kcal: 0, p: 0, c: 0, f: 0 },
);
