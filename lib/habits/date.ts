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
