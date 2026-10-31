import { createHash } from 'node:crypto';

const FOLDER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(.+)$/;
const YEAR_PATTERN = /^\d{4}$/;
const JPEG_PATTERN = /\.jpe?g$/i;

export interface ParsedFolderName {
  date: string;
  title: string;
}

/**
 * Ordnername yyyy-mm-dd_<Titel> zerlegen. Liefert null, wenn das Präfix fehlt
 * oder kein gültiges Kalenderdatum ist.
 */
export function parseFolderName(name: string): ParsedFolderName | null {
  const match = FOLDER_PATTERN.exec(name);
  if (!match) return null;
  const [, y, m, d, rawTitle] = match as unknown as [string, string, string, string, string];
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const title = rawTitle.replace(/_+/g, ' ').trim();
  if (!title) return null;
  return { date: `${y}-${m}-${d}`, title };
}

/** Jahresordner (z. B. 2025), unter denen die eigentlichen Bilder-Ordner liegen dürfen. */
export function isYearFolder(name: string): boolean {
  return YEAR_PATTERN.test(name);
}

export function isJpeg(name: string): boolean {
  return JPEG_PATTERN.test(name) && !name.startsWith('.');
}

/** Stabile, URL-taugliche ID aus dem relativen Ordnerpfad. */
export function folderId(relPath: string): string {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 16);
}
