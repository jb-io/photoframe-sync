import fs from 'node:fs/promises';
import type { CardFileRow, Store } from '../db.js';
import { type CardFile, FlashAir, FlashAirError } from '../device/flashair.js';
import type { FrameCache } from '../frame/cache.js';
import type { Logger } from '../log.js';
import type { NamedImage } from './plan.js';

/** Puffer, der auf der Karte frei bleiben soll (FAT, Rahmen-eigene Dateien). */
const SPACE_RESERVE_BYTES = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_CONSECUTIVE_FAILURES = 3;

export class CardFullError extends Error {}
export class SyncAbortedError extends Error {}

export interface SyncProgress {
  phase: 'preparing' | 'uploading' | 'deleting';
  done: number;
  total: number;
}

export interface SyncDeps {
  card: FlashAir;
  cache: FrameCache;
  store: Store;
  log: Logger;
  deleteExtra: boolean;
  onProgress: (p: SyncProgress) => void;
  /** Wird zwischen zwei Dateien abgefragt (Ausschalten, Herunterfahren) */
  shouldAbort: () => boolean;
}

export interface SyncResult {
  uploaded: number;
  deleted: number;
  failed: number;
  freeBytes: number | null;
  totalBytes: number | null;
  /** Belegung durch Dateien, die der Sync verwalten darf */
  reclaimableBytes: number;
}

export interface CardDiff {
  upload: NamedImage[];
  /** Überzählige Dateien (Spiegelbetrieb) */
  remove: CardFile[];
  /** Dateien, die vor dem Upload ersetzt werden müssen */
  replace: Set<string>;
}

/**
 * Soll (geplante Bilder) gegen Ist (Dateiliste der Karte + was wir laut DB
 * hochgeladen haben) abgleichen. Geschützte Dateien und Unterordner tauchen in
 * `remove` nie auf; Dateien mit fremdem Inhalt unter einem Soll-Namen werden ersetzt.
 */
export function diffCard(planned: NamedImage[], onCard: CardFile[], tracked: CardFileRow[], deleteExtra: boolean): CardDiff {
  const cardByName = new Map(onCard.map((f) => [f.name.toUpperCase(), f]));
  const trackedByName = new Map(tracked.map((t) => [t.name.toUpperCase(), t]));
  const wanted = new Set(planned.map((p) => p.cardName.toUpperCase()));

  const upload: NamedImage[] = [];
  const replace = new Set<string>();
  for (const img of planned) {
    const key = img.cardName.toUpperCase();
    const present = cardByName.get(key);
    const known = trackedByName.get(key);
    const upToDate = present && known && known.frameKey === img.frameKey && known.size === present.size;
    if (upToDate) continue;
    if (present) {
      // Unter dem Namen liegt etwas anderes. Geschützte Dateien werden nie überschrieben.
      if (present.protected) continue;
      replace.add(img.cardName);
    }
    upload.push(img);
  }

  const remove = deleteExtra ? onCard.filter((f) => !f.protected && !wanted.has(f.name.toUpperCase())) : [];
  return { upload, remove, replace };
}

async function withRetry<T>(what: string, log: Logger, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        log.debug({ err, attempt }, `${what}: neuer Versuch`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Ein Sync-Lauf. Inkrementell: Was passt, bleibt liegen. Jeder Upload wird
 * sofort in der DB vermerkt, deshalb setzt ein abgebrochener Lauf beim
 * nächsten Mal genau dort fort (FA-30).
 */
export async function runSync(planned: NamedImage[], deps: SyncDeps): Promise<SyncResult> {
  const { card, cache, store, log } = deps;

  const onCard = await card.list();
  const cardNames = new Set(onCard.map((f) => f.name.toUpperCase()));

  // DB-Einträge zu Dateien, die nicht mehr auf der Karte sind, verwerfen.
  for (const row of store.cardFiles()) {
    if (!cardNames.has(row.name.toUpperCase())) store.deleteCardFile(row.name);
  }

  const diff = diffCard(planned, onCard, store.cardFiles(), deps.deleteExtra);
  const total = diff.remove.length + diff.upload.length;
  let done = 0;
  let deleted = 0;
  let uploaded = 0;
  let failed = 0;
  log.info({ upload: diff.upload.length, remove: diff.remove.length, keep: planned.length - diff.upload.length }, 'Sync-Plan');

  let space = await card.space();
  let freeBytes = space.freeBytes;

  if (diff.remove.length) {
    deps.onProgress({ phase: 'deleting', done, total });
    for (const file of diff.remove) {
      if (deps.shouldAbort()) throw new SyncAbortedError('Sync abgebrochen');
      await withRetry(`Löschen ${file.name}`, log, () => card.remove(file.name));
      store.deleteCardFile(file.name);
      freeBytes += file.size;
      deleted += 1;
      done += 1;
      deps.onProgress({ phase: 'deleting', done, total });
    }
  }

  if (diff.upload.length) {
    await card.prepareUpload();
    let consecutiveFailures = 0;
    const sizeOnCard = new Map(onCard.map((f) => [f.name.toUpperCase(), f.size]));

    for (const img of diff.upload) {
      if (deps.shouldAbort()) throw new SyncAbortedError('Sync abgebrochen');
      deps.onProgress({ phase: 'preparing', done, total });

      let data: Buffer;
      try {
        data = await fs.readFile(await cache.ensureFrame(img.rel, img.frameKey));
      } catch (err) {
        // Original nicht lesbar oder defekt: überspringen, Karte bleibt unverändert.
        log.warn({ err, rel: img.rel }, 'Rahmenbild konnte nicht erzeugt werden');
        failed += 1;
        done += 1;
        continue;
      }

      const replaced = diff.replace.has(img.cardName) ? (sizeOnCard.get(img.cardName.toUpperCase()) ?? 0) : 0;
      if (data.length + SPACE_RESERVE_BYTES > freeBytes + replaced) {
        throw new CardFullError(`Speicher der Karte voll – ${uploaded} Bilder übertragen, ${diff.upload.length - uploaded} fehlen`);
      }

      deps.onProgress({ phase: 'uploading', done, total });
      try {
        if (diff.replace.has(img.cardName)) {
          // Die Karte überschreibt bestehende Dateien nicht zuverlässig – vorher löschen.
          await withRetry(`Löschen ${img.cardName}`, log, () => card.remove(img.cardName));
          store.deleteCardFile(img.cardName);
          freeBytes += replaced;
          diff.replace.delete(img.cardName);
        }
        await withRetry(`Upload ${img.cardName}`, log, () => card.upload(img.cardName, data));
        store.putCardFile({
          name: img.cardName,
          rel: img.rel,
          folderId: img.folderId,
          frameKey: img.frameKey,
          size: data.length,
          uploadedAt: Date.now(),
        });
        freeBytes -= data.length;
        uploaded += 1;
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof FlashAirError) {
          consecutiveFailures += 1;
          failed += 1;
          log.warn({ err, file: img.cardName }, 'Upload fehlgeschlagen');
          // Mehrere Fehler in Folge heißen: Karte weg. Dann abbrechen und später fortsetzen.
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw err;
        } else {
          throw err;
        }
      }
      done += 1;
      deps.onProgress({ phase: 'uploading', done, total });
    }
  }

  space = await card.space().catch(() => ({ freeBytes, totalBytes: space.totalBytes }));
  const finalList = await card.list().catch(() => null);
  const reclaimableBytes = (finalList ?? []).filter((f) => !f.protected).reduce((sum, f) => sum + f.size, 0);
  log.info({ uploaded, deleted, failed }, 'Sync fertig');
  return { uploaded, deleted, failed, freeBytes: space.freeBytes, totalBytes: space.totalBytes, reclaimableBytes };
}
