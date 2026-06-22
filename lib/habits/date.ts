// Date helpers that use the USER's clock, not the server's.
// Per cheat sheet Bug 8.2: habits must roll over at midnight in YOUR timezone,
// not midnight UTC, or they reset at 4pm PT.

export const USER_TIMEZONE = process.env.USER_TIMEZONE || 'America/Los_Angeles';

/** Returns 'YYYY-MM-DD' for "today" in the user's timezone. */
export function localDateKey(date: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD format directly
  return date.toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

/** Returns 'YYYY-MM-DD' for N days before today in the user's timezone. */
export function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateKey(d);
}

/** Hour/minute/day-of-week in the user's timezone. Day-of-week: 0=Sun..6=Sat. */
export function localClock(date: Date = new Date()): { hour: number; minute: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[get('weekday')] ?? date.getDay();
  return { hour, minute, dayOfWeek };
}
