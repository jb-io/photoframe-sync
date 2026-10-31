import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Folder, Selection } from '../shared/types.js';
import { DEFAULT_SELECTION } from '../shared/types.js';

export interface ImageRow {
  folderId: string;
  /** Pfad relativ zum Bilderverzeichnis */
  rel: string;
  mtimeMs: number;
  size: number;
}

export interface CardFileRow {
  /** Dateiname auf der Karte */
  name: string;
  /** Quellbild (relativer Pfad) */
  rel: string;
  folderId: string;
  /** Schlüssel des hochgeladenen Rahmenbilds */
  frameKey: string;
  size: number;
  uploadedAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  image_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  folder_id TEXT NOT NULL,
  rel TEXT NOT NULL PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS images_folder ON images(folder_id);
CREATE TABLE IF NOT EXISTS card_files (
  name TEXT PRIMARY KEY,
  rel TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  frame_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
);
`;

/** Zustand in SQLite (Volume /data). Synchron, weil node:sqlite synchron arbeitet. */
export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'state.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- Schlüssel/Wert ---------------------------------------------------

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  selection(): Selection {
    return { ...DEFAULT_SELECTION, ...this.get<Partial<Selection>>('selection', {}) };
  }

  // --- Ordner-Scan ------------------------------------------------------

  folders(): Folder[] {
    const rows = this.db
      .prepare('SELECT id, name, path, date, title, image_count FROM folders ORDER BY date DESC, name DESC')
      .all() as { id: string; name: string; path: string; date: string; title: string; image_count: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, date: r.date, title: r.title, imageCount: r.image_count }));
  }

  /** Scan-Ergebnis komplett ersetzen. */
  replaceScan(folders: Folder[], images: ImageRow[]): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM folders; DELETE FROM images;');
      const insertFolder = this.db.prepare(
        'INSERT INTO folders (id, name, path, date, title, image_count) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const f of folders) insertFolder.run(f.id, f.name, f.path, f.date, f.title, f.imageCount);
      const insertImage = this.db.prepare('INSERT INTO images (folder_id, rel, mtime_ms, size) VALUES (?, ?, ?, ?)');
      for (const i of images) insertImage.run(i.folderId, i.rel, Math.round(i.mtimeMs), i.size);
    });
  }

  images(folderId: string): ImageRow[] {
    const rows = this.db
      .prepare('SELECT folder_id, rel, mtime_ms, size FROM images WHERE folder_id = ? ORDER BY rel')
      .all(folderId) as { folder_id: string; rel: string; mtime_ms: number; size: number }[];
    return rows.map((r) => ({ folderId: r.folder_id, rel: r.rel, mtimeMs: r.mtime_ms, size: r.size }));
  }

  // --- Karte ------------------------------------------------------------

  cardFiles(): CardFileRow[] {
    const rows = this.db
      .prepare('SELECT name, rel, folder_id, frame_key, size, uploaded_at FROM card_files')
      .all() as { name: string; rel: string; folder_id: string; frame_key: string; size: number; uploaded_at: number }[];
    return rows.map((r) => ({
      name: r.name,
      rel: r.rel,
      folderId: r.folder_id,
      frameKey: r.frame_key,
      size: r.size,
      uploadedAt: r.uploaded_at,
    }));
  }

  putCardFile(row: CardFileRow): void {
    this.db
      .prepare(
        `INSERT INTO card_files (name, rel, folder_id, frame_key, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET rel = excluded.rel, folder_id = excluded.folder_id,
           frame_key = excluded.frame_key, size = excluded.size, uploaded_at = excluded.uploaded_at`,
      )
      .run(row.name, row.rel, row.folderId, row.frameKey, row.size, row.uploadedAt);
  }

  deleteCardFile(name: string): void {
    this.db.prepare('DELETE FROM card_files WHERE name = ?').run(name);
  }
}
