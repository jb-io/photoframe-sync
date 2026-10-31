import { pino, type Logger } from 'pino';

export type { Logger };

/** Strukturierte JSON-Logs auf stdout. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
