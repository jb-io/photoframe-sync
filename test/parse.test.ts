import { describe, expect, it } from 'vitest';
import { folderId, isJpeg, isYearFolder, parseFolderName } from '../src/server/folders/parse.js';

describe('parseFolderName', () => {
  it('zerlegt Datum und Titel, Unterstriche werden Leerzeichen', () => {
    expect(parseFolderName('2026-10-18_Herbstwanderung_Allgäu')).toEqual({ date: '2026-10-18', title: 'Herbstwanderung Allgäu' });
  });

  it('lehnt fehlendes oder ungültiges Datumspräfix ab', () => {
    expect(parseFolderName('Urlaub')).toBeNull();
    expect(parseFolderName('2026-10-18')).toBeNull();
    expect(parseFolderName('2026-10-18_')).toBeNull();
    expect(parseFolderName('2026-02-30_Kein_Tag')).toBeNull();
    expect(parseFolderName('2026-13-01_Monat')).toBeNull();
    expect(parseFolderName('26-10-18_Kurz')).toBeNull();
  });

  it('erkennt Jahresordner', () => {
    expect(isYearFolder('2025')).toBe(true);
    expect(isYearFolder('2025-01')).toBe(false);
  });

  it('akzeptiert nur JPEG-Endungen ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    expect(['a.jpg', 'b.JPG', 'c.jpeg', 'd.JPEG'].every(isJpeg)).toBe(true);
    expect(['e.png', 'f.heic', '.hidden.jpg', 'jpg'].some(isJpeg)).toBe(false);
  });

  it('liefert stabile IDs', () => {
    expect(folderId('2025/2025-01-01_Neujahr')).toBe(folderId('2025/2025-01-01_Neujahr'));
    expect(folderId('2025/2025-01-01_Neujahr')).toMatch(/^[0-9a-f]{16}$/);
  });
});
