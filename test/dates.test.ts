import { describe, expect, it } from 'vitest';
import { monthEnd, monthsBefore } from '../src/shared/dates.js';
import { msUntilNextDay, todayIn } from '../src/server/time.js';

describe('Datumslogik', () => {
  it('zieht Monate ab und kürzt auf das Monatsende', () => {
    expect(monthsBefore('2026-10-31', 1)).toBe('2026-09-30');
    expect(monthsBefore('2026-10-31', 12)).toBe('2025-10-31');
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBefore('2024-03-31', 1)).toBe('2024-02-29');
    expect(monthsBefore('2026-01-15', 36)).toBe('2023-01-15');
  });

  it('kennt das Monatsende', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('rechnet „heute“ in der konfigurierten Zeitzone', () => {
    const lateUtc = new Date('2026-10-31T23:30:00Z');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-31');
    expect(todayIn('Europe/Berlin', lateUtc)).toBe('2026-11-01');
  });

  it('findet die nächste Mitternacht', () => {
    const now = new Date('2026-10-31T21:30:00Z'); // 22:30 in Berlin (Winterzeit)
    const ms = msUntilNextDay('Europe/Berlin', now);
    expect(ms).toBeGreaterThan(89 * 60_000);
    expect(ms).toBeLessThan(92 * 60_000);
  });
});
