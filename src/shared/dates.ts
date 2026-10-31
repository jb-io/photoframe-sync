// Datumswerte als yyyy-mm-dd-Strings – in Server und Oberfläche identisch.

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Beginn des Automatik-Zeitraums: Datum minus n Monate, gleicher Tag
 * (am Monatsende auf den letzten gültigen Tag gekürzt).
 */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Letzter Tag eines Monats (yyyy-mm) als yyyy-mm-dd. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}
