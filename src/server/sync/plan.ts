import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Folder, Selection } from '../../shared/types.js';
import type { ImageRow } from '../db.js';
import { monthsBefore } from '../time.js';

export interface PlannedImage {
  folderId: string;
  rel: string;
  mtimeMs: number;
  /** Schlüssel des Rahmenbilds im Cache (Pfad, Änderungszeit, Konfiguration) */
  frameKey: string;
}

export interface NamedImage extends PlannedImage {
  /** Dateiname auf der Karte */
  cardName: string;
}

/** Ordner, die laut Auswahl auf den Rahmen gehören (Soll). */
export function selectedFolders(selection: Selection, folders: Folder[], today: string): Folder[] {
  if (selection.mode === 'auto') {
    const from = monthsBefore(today, selection.windowMonths);
    return folders.filter((f) => f.date >= from && f.date <= today);
  }
  const wanted = new Set(selection.manual);
  return folders.filter((f) => wanted.has(f.id));
}

/** Deterministischer Zufallsgenerator (mulberry32) aus einem beliebigen String. */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Begrenzung pro Ordner (FA-23): zufällige Auswahl mit Seed aus Tagesdatum und
 * Ordnername. Innerhalb eines Tages stabil, ab Mitternacht neu. Die gewählten
 * Bilder behalten ihre ursprüngliche Reihenfolge.
 */
export function limitImages(images: ImageRow[], limit: number, seed: string): ImageRow[] {
  if (images.length <= limit) return images;
  const picked = new Set(shuffled(images, seededRandom(seed)).slice(0, limit).map((i) => i.rel));
  return images.filter((i) => picked.has(i.rel));
}

export function frameKey(rel: string, mtimeMs: number, configHash: string): string {
  return createHash('sha1').update(`${rel}\0${Math.round(mtimeMs)}\0${configHash}`).digest('hex').slice(0, 20);
}

/**
 * Soll-Liste der Bilder in Anzeige-Reihenfolge: Ordner chronologisch
 * aufsteigend, innerhalb eines Ordners nach Pfad.
 */
export function plannedImages(
  folders: Folder[],
  imagesOf: (folderId: string) => ImageRow[],
  selection: Selection,
  today: string,
  configHash: string,
): PlannedImage[] {
  const ordered = [...folders].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
  const out: PlannedImage[] = [];
  for (const folder of ordered) {
    let images = imagesOf(folder.id);
    if (selection.scope === 'limit') images = limitImages(images, selection.perFolder, `${today}|${folder.name}`);
    for (const img of images) {
      out.push({ folderId: folder.id, rel: img.rel, mtimeMs: img.mtimeMs, frameKey: frameKey(img.rel, img.mtimeMs, configHash) });
    }
  }
  return out;
}

export function dcimName(index: number): string {
  return `IMG_${String(index).padStart(4, '0')}.JPG`;
}

const DCIM_PATTERN = /^IMG_(\d{4})\.JPG$/;

function originalBase(rel: string): string {
  const base = path.posix.basename(rel, path.posix.extname(rel));
  return (
    base
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'BILD'
  );
}

export interface NamingOptions {
  naming: 'dcim' | 'original';
  order: 'original' | 'random';
  /** Bisherige Zuordnung Quellbild → Kartenname (für stabile Namen bei random) */
  previous: Map<string, string>;
  /** Seed für die Zufallsreihenfolge; ändert sich bei „Reihenfolge neu mischen“ */
  shuffleSeed: string;
}

/**
 * Kartennamen vergeben (FA-31).
 * - dcim + original: IMG_0001.JPG … in Soll-Reihenfolge
 * - dcim + random: bereits vergebene Nummern bleiben, neue Bilder bekommen
 *   zufällige freie Nummern – so wird nicht bei jeder Änderung alles neu übertragen
 * - original: Dateiname des Originals (bei Kollision mit Zähler); bei random
 *   mit Zufallspräfix, damit der Rahmen gemischt anzeigt
 */
export function assignCardNames(images: PlannedImage[], options: NamingOptions): NamedImage[] {
  if (options.naming === 'dcim' && options.order === 'original') {
    return images.map((img, i) => ({ ...img, cardName: dcimName(i + 1) }));
  }

  if (options.naming === 'dcim') {
    const taken = new Set<number>();
    const names = new Map<string, string>();
    const missing: PlannedImage[] = [];
    for (const img of images) {
      const previous = options.previous.get(img.rel);
      const match = previous ? DCIM_PATTERN.exec(previous) : null;
      const number = match ? Number(match[1]) : NaN;
      if (match && !taken.has(number)) {
        taken.add(number);
        names.set(img.rel, previous!);
      } else {
        missing.push(img);
      }
    }
    const free: number[] = [];
    for (let n = 1; free.length < missing.length; n += 1) if (!taken.has(n)) free.push(n);
    const random = seededRandom(`${options.shuffleSeed}|${images.length}`);
    const mixed = shuffled(free, random);
    missing.forEach((img, i) => names.set(img.rel, dcimName(mixed[i]!)));
    return images.map((img) => ({ ...img, cardName: names.get(img.rel)! }));
  }

  const used = new Set<string>();
  const order =
    options.order === 'random' ? shuffled(images, seededRandom(options.shuffleSeed)) : images;
  const names = new Map<string, string>();
  order.forEach((img, i) => {
    const prefix = options.order === 'random' ? `${String(i + 1).padStart(4, '0')}_` : '';
    const base = `${prefix}${originalBase(img.rel)}`;
    let candidate = `${base}.JPG`;
    let counter = 1;
    while (used.has(candidate.toUpperCase())) candidate = `${base}_${counter++}.JPG`;
    used.add(candidate.toUpperCase());
    names.set(img.rel, candidate);
  });
  return images.map((img) => ({ ...img, cardName: names.get(img.rel)! }));
}
