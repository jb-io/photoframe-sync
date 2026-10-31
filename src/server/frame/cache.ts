import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { createLimit } from '../limit.js';
import type { Logger } from '../log.js';
import { renderFrameImage, renderThumb } from './processor.js';

async function writeAtomic(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abgeleitete Dateien im Cache-Ordner: Rahmenbilder (/cache/frame) und
 * Ordner-Vorschauen (/cache/thumbs). Alles darin darf gelöscht werden.
 */
export class FrameCache {
  readonly frameDir: string;
  readonly thumbDir: string;
  /** Lesezugriffe auf das Netzlaufwerk für Vorschauen (THUMB_CONCURRENCY) */
  private thumbLimit: ReturnType<typeof createLimit>;
  /** Aufbereitung nacheinander – sharp nutzt intern ohnehin mehrere Threads */
  private frameLimit = createLimit(1);
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private cfg: Config,
    private log: Logger,
  ) {
    this.frameDir = path.join(cfg.cacheDir, 'frame');
    this.thumbDir = path.join(cfg.cacheDir, 'thumbs');
    this.thumbLimit = createLimit(cfg.thumbConcurrency);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.frameDir, { recursive: true });
    await fs.mkdir(this.thumbDir, { recursive: true });
  }

  framePath(key: string): string {
    return path.join(this.frameDir, `${key}.jpg`);
  }

  hasFrame(key: string): Promise<boolean> {
    return exists(this.framePath(key));
  }

  /** Rahmenbild sicherstellen; liefert den Pfad im Cache. */
  ensureFrame(rel: string, key: string): Promise<string> {
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.frameLimit(async () => {
      const file = this.framePath(key);
      if (await exists(file)) return file;
      const started = Date.now();
      const input = await fs.readFile(path.join(this.cfg.photosDir, rel));
      const output = await renderFrameImage(input, this.cfg.frame);
      await writeAtomic(file, output);
      this.log.debug({ rel, key, kb: Math.round(output.length / 1024), ms: Date.now() - started }, 'Rahmenbild erzeugt');
      return file;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async frameSize(key: string): Promise<number | null> {
    try {
      return (await fs.stat(this.framePath(key))).size;
    } catch {
      return null;
    }
  }

  /** Nicht mehr benötigte Rahmenbilder löschen (FA-33). */
  async cleanupFrames(keep: Set<string>): Promise<number> {
    let removed = 0;
    for (const name of await fs.readdir(this.frameDir)) {
      const key = name.replace(/\.jpg$/, '');
      if (keep.has(key) || this.inflight.has(key)) continue;
      await fs.rm(path.join(this.frameDir, name), { force: true });
      removed += 1;
    }
    if (removed) this.log.info({ removed }, 'Nicht mehr ausgewählte Rahmenbilder aufgeräumt');
    return removed;
  }

  /** Größen aller Rahmenbilder im Cache (für die Platzschätzung). */
  async frameSizes(): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    for (const name of await fs.readdir(this.frameDir).catch(() => [] as string[])) {
      if (!name.endsWith('.jpg')) continue;
      const stat = await fs.stat(path.join(this.frameDir, name)).catch(() => null);
      if (stat) sizes.set(name.slice(0, -4), stat.size);
    }
    return sizes;
  }

  /**
   * Vorschau eines Ordners (erstes JPEG nach Pfad). Der Dateiname enthält die
   * Änderungszeit, damit eine geänderte Vorlage eine neue Vorschau ergibt (FA-08).
   */
  async ensureThumb(folderId: string, rel: string, mtimeMs: number): Promise<string> {
    const tag = createHash('sha1').update(`${rel}\0${Math.round(mtimeMs)}\0${this.cfg.thumbSize}`).digest('hex').slice(0, 10);
    const file = path.join(this.thumbDir, `${folderId}-${tag}.jpg`);
    if (await exists(file)) return file;
    const job = this.inflight.get(file);
    if (job) return job;
    const run = this.thumbLimit(async () => {
      if (await exists(file)) return file;
      const input = await fs.readFile(path.join(this.cfg.photosDir, rel));
      await writeAtomic(file, await renderThumb(input, this.cfg.thumbSize));
      // Ältere Vorschauen desselben Ordners entfernen.
      for (const name of await fs.readdir(this.thumbDir)) {
        if (name.startsWith(`${folderId}-`) && name !== path.basename(file)) {
          await fs.rm(path.join(this.thumbDir, name), { force: true });
        }
      }
      return file;
    }).finally(() => this.inflight.delete(file));
    this.inflight.set(file, run);
    return run;
  }
}
