import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Folder } from '../../shared/types.js';
import type { ImageRow } from '../db.js';
import { createLimit } from '../limit.js';
import type { Logger } from '../log.js';
import { folderId, isJpeg, isYearFolder, parseFolderName } from './parse.js';

export interface ScanResult {
  folders: Folder[];
  images: ImageRow[];
}

export class ScanError extends Error {}

async function readDir(dir: string): Promise<Dirent[]> {
  return fs.readdir(dir, { withFileTypes: true });
}

/** Alle JPEGs eines Ordners, Unterordner beliebiger Tiefe eingeschlossen (FA-03). */
async function collectImages(root: string, rel: string, id: string, out: ImageRow[], log: Logger): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readDir(path.join(root, rel));
  } catch (err) {
    log.warn({ err, dir: rel }, 'Ordner nicht lesbar');
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('@')) continue;
    const childRel = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) {
      await collectImages(root, childRel, id, out, log);
    } else if (entry.isFile() && isJpeg(entry.name)) {
      try {
        const stat = await fs.stat(path.join(root, childRel));
        out.push({ folderId: id, rel: childRel, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (err) {
        log.debug({ err, file: childRel }, 'Bild nicht lesbar');
      }
    }
  }
}

/**
 * Bilderverzeichnis scannen. Erkannt werden Ordner yyyy-mm-dd_<Titel> auf der
 * ersten Ebene sowie eine Ebene tiefer in Jahresordnern (z. B. 2025/…).
 * Wirft ScanError, wenn das Verzeichnis nicht lesbar ist.
 */
export async function scanPhotos(root: string, log: Logger, concurrency = 4): Promise<ScanResult> {
  let top: Dirent[];
  try {
    top = await readDir(root);
  } catch (err) {
    throw new ScanError(`Bilderverzeichnis ${root} ist nicht lesbar: ${(err as Error).message}`);
  }

  const candidates: { name: string; rel: string }[] = [];
  for (const entry of top) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('@')) continue;
    if (parseFolderName(entry.name)) {
      candidates.push({ name: entry.name, rel: entry.name });
    } else if (isYearFolder(entry.name)) {
      let inner: Dirent[];
      try {
        inner = await readDir(path.join(root, entry.name));
      } catch (err) {
        log.warn({ err, dir: entry.name }, 'Jahresordner nicht lesbar');
        continue;
      }
      for (const child of inner) {
        if (!child.isDirectory() || child.name.startsWith('.')) continue;
        if (parseFolderName(child.name)) candidates.push({ name: child.name, rel: `${entry.name}/${child.name}` });
        else log.debug({ dir: `${entry.name}/${child.name}` }, 'Ordner ohne gültiges Datumspräfix ignoriert');
      }
    } else {
      log.debug({ dir: entry.name }, 'Ordner ohne gültiges Datumspräfix ignoriert');
    }
  }

  const limit = createLimit(concurrency);
  const results = await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        const parsed = parseFolderName(c.name)!;
        const id = folderId(c.rel);
        const images: ImageRow[] = [];
        await collectImages(root, c.rel, id, images, log);
        const folder: Folder = { id, name: c.name, path: c.rel, date: parsed.date, title: parsed.title, imageCount: images.length };
        return { folder, images };
      }),
    ),
  );

  results.sort((a, b) => (a.folder.date === b.folder.date ? b.folder.name.localeCompare(a.folder.name) : a.folder.date < b.folder.date ? 1 : -1));
  return {
    folders: results.map((r) => r.folder),
    images: results.flatMap((r) => r.images),
  };
}
