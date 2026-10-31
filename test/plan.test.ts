import { describe, expect, it } from 'vitest';
import type { Folder, Selection } from '../src/shared/types.js';
import { DEFAULT_SELECTION } from '../src/shared/types.js';
import type { ImageRow } from '../src/server/db.js';
import { assignCardNames, frameKey, limitImages, plannedImages, selectedFolders } from '../src/server/sync/plan.js';

const folder = (date: string, title: string, imageCount = 10): Folder => ({
  id: `${date}-${title}`,
  name: `${date}_${title}`,
  path: `${date.slice(0, 4)}/${date}_${title}`,
  date,
  title,
  imageCount,
});

const images = (f: Folder, count = f.imageCount): ImageRow[] =>
  Array.from({ length: count }, (_, i) => ({ folderId: f.id, rel: `${f.path}/IMG_${String(i + 1).padStart(3, '0')}.jpg`, mtimeMs: 1000 + i, size: 100 }));

const FOLDERS = [folder('2026-10-18', 'Herbst'), folder('2026-01-01', 'Neujahr'), folder('2025-11-01', 'Laterne'), folder('2025-10-30', 'Alt')];
const sel = (p: Partial<Selection>): Selection => ({ ...DEFAULT_SELECTION, ...p });

describe('selectedFolders', () => {
  it('Automatik: letzte n Monate relativ zu heute', () => {
    expect(selectedFolders(sel({ mode: 'auto', windowMonths: 12 }), FOLDERS, '2026-10-31').map((f) => f.title)).toEqual(['Herbst', 'Neujahr', 'Laterne']);
    expect(selectedFolders(sel({ mode: 'auto', windowMonths: 1 }), FOLDERS, '2026-10-31').map((f) => f.title)).toEqual(['Herbst']);
  });

  it('Automatik: Ordner aus der Zukunft gehören nicht dazu', () => {
    expect(selectedFolders(sel({ mode: 'auto', windowMonths: 36 }), FOLDERS, '2026-06-01').map((f) => f.title)).not.toContain('Herbst');
  });

  it('Manuell: nur gewählte, existierende Ordner', () => {
    const picked = selectedFolders(sel({ mode: 'manual', manual: [FOLDERS[3]!.id, 'gibt-es-nicht'] }), FOLDERS, '2026-10-31');
    expect(picked.map((f) => f.title)).toEqual(['Alt']);
  });
});

describe('limitImages (FA-23)', () => {
  const f = folder('2026-01-01', 'Neujahr', 40);
  const all = images(f);

  it('ist innerhalb eines Tages stabil und behält die Reihenfolge', () => {
    const a = limitImages(all, 10, '2026-10-31|x');
    const b = limitImages(all, 10, '2026-10-31|x');
    expect(a).toHaveLength(10);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x.rel.localeCompare(y.rel))).toEqual(a);
  });

  it('wählt am Folgetag andere Bilder', () => {
    const a = limitImages(all, 10, '2026-10-31|x').map((i) => i.rel);
    const b = limitImages(all, 10, '2026-11-01|x').map((i) => i.rel);
    expect(a).not.toEqual(b);
  });

  it('lässt kleinere Ordner unverändert', () => {
    expect(limitImages(all, 50, 'seed')).toBe(all);
  });
});

describe('plannedImages', () => {
  it('sortiert Ordner chronologisch aufsteigend und begrenzt pro Ordner', () => {
    const planned = plannedImages(FOLDERS.slice(0, 2), (id) => images(FOLDERS.find((f) => f.id === id)!), sel({ scope: 'limit', perFolder: 3 }), '2026-10-31', 'cfg');
    expect(planned).toHaveLength(6);
    expect(planned[0]!.rel).toContain('Neujahr');
    expect(planned[5]!.rel).toContain('Herbst');
  });

  it('Rahmenbild-Schlüssel hängt an Pfad, Änderungszeit und Konfiguration', () => {
    expect(frameKey('a.jpg', 1, 'x')).toBe(frameKey('a.jpg', 1, 'x'));
    expect(frameKey('a.jpg', 1, 'x')).not.toBe(frameKey('a.jpg', 2, 'x'));
    expect(frameKey('a.jpg', 1, 'x')).not.toBe(frameKey('a.jpg', 1, 'y'));
  });
});

describe('assignCardNames (FA-31)', () => {
  const planned = plannedImages(FOLDERS.slice(0, 2), (id) => images(FOLDERS.find((f) => f.id === id)!, 3), sel({}), '2026-10-31', 'cfg');

  it('dcim + original: fortlaufend in Soll-Reihenfolge', () => {
    const named = assignCardNames(planned, { naming: 'dcim', order: 'original', previous: new Map(), shuffleSeed: 's' });
    expect(named.map((n) => n.cardName)).toEqual(['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG', 'IMG_0006.JPG']);
  });

  it('dcim + random: bestehende Nummern bleiben, neue werden frei verteilt', () => {
    const first = assignCardNames(planned.slice(0, 4), { naming: 'dcim', order: 'random', previous: new Map(), shuffleSeed: 's' });
    expect(new Set(first.map((n) => n.cardName)).size).toBe(4);
    const previous = new Map(first.map((n) => [n.rel, n.cardName]));
    const second = assignCardNames(planned, { naming: 'dcim', order: 'random', previous, shuffleSeed: 's' });
    for (const n of first) expect(second.find((s) => s.rel === n.rel)!.cardName).toBe(n.cardName);
    expect(new Set(second.map((n) => n.cardName)).size).toBe(6);
  });

  it('dcim + random: Nummern sind gemischt, lückenlos und je Seed stabil', () => {
    const many = plannedImages([folder('2026-01-01', 'Viele', 40)], (id) => images({ ...folder('2026-01-01', 'Viele', 40), id }), sel({}), '2026-10-31', 'cfg');
    const opts = { naming: 'dcim' as const, order: 'random' as const, previous: new Map<string, string>(), shuffleSeed: 'a' };
    const named = assignCardNames(many, opts).map((n) => n.cardName);
    expect([...named].sort()).toEqual(Array.from({ length: 40 }, (_, i) => `IMG_${String(i + 1).padStart(4, '0')}.JPG`));
    expect(named).not.toEqual([...named].sort());
    expect(assignCardNames(many, opts).map((n) => n.cardName)).toEqual(named);
    expect(assignCardNames(many, { ...opts, shuffleSeed: 'b' }).map((n) => n.cardName)).not.toEqual(named);
  });

  it('original: Dateiname des Originals, Kollisionen mit Zähler', () => {
    const named = assignCardNames(planned, { naming: 'original', order: 'original', previous: new Map(), shuffleSeed: 's' });
    expect(named.map((n) => n.cardName).slice(0, 4)).toEqual(['IMG_001.JPG', 'IMG_002.JPG', 'IMG_003.JPG', 'IMG_001_1.JPG']);
  });
});
