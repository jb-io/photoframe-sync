import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScanError, scanPhotos } from '../src/server/folders/scanner.js';
import { silentLog, tempDir, writeJpeg } from './helpers.js';

describe('scanPhotos', () => {
  it('findet Ordner auf erster Ebene und in Jahresordnern, zählt Bilder in Unterordnern', async () => {
    const root = await tempDir();
    await writeJpeg(path.join(root, '2024-05-01_Mai/a.jpg'), 40, 30);
    await writeJpeg(path.join(root, '2025/2025-07-12_Radtour/b.JPG'), 40, 30);
    await writeJpeg(path.join(root, '2025/2025-07-12_Radtour/Handy/tief/c.jpeg'), 40, 30);
    await fs.writeFile(path.join(root, '2025/2025-07-12_Radtour/notiz.txt'), 'x');
    await writeJpeg(path.join(root, 'Sonstiges/d.jpg'), 40, 30);
    await writeJpeg(path.join(root, '2025/Ohne_Datum/e.jpg'), 40, 30);

    const result = await scanPhotos(root, silentLog);
    expect(result.folders.map((f) => [f.path, f.imageCount])).toEqual([
      ['2025/2025-07-12_Radtour', 2],
      ['2024-05-01_Mai', 1],
    ]);
    expect(result.images.map((i) => i.rel)).toContain('2025/2025-07-12_Radtour/Handy/tief/c.jpeg');
  });

  it('wirft ScanError, wenn das Verzeichnis fehlt', async () => {
    await expect(scanPhotos('/gibt/es/nicht', silentLog)).rejects.toBeInstanceOf(ScanError);
  });
});
