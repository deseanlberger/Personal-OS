/** Convert "HH:MM" (24h, e.g. "12:00" or "07:30") to "h:mm AM/PM". */
export function to12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}
