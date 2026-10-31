// Datumslogik in der konfigurierten Zeitzone (TZ). Datumswerte sind Strings
// im Format yyyy-mm-dd – so gibt es keine Verwechslung mit UTC-Mitternacht.

export { monthsBefore } from '../shared/dates.js';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Heutiges Datum in der Zeitzone als yyyy-mm-dd. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return formatter(timeZone).format(now);
}

/** Millisekunden bis zur nächsten Mitternacht in der Zeitzone (plus kleiner Puffer). */
export function msUntilNextDay(timeZone: string, now: Date = new Date()): number {
  const today = todayIn(timeZone, now);
  // In Minutenschritten wäre es exakt, Stunden reichen aber und sind billig:
  // ab dem Wechsel wird minutengenau gesucht.
  let probe = now.getTime();
  const hour = 3600_000;
  while (todayIn(timeZone, new Date(probe + hour)) === today) probe += hour;
  while (todayIn(timeZone, new Date(probe)) === today) probe += 60_000;
  return probe - now.getTime() + 1000;
}
