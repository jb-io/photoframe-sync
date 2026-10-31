import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { partialCropRegion, renderFrameImage } from '../src/server/frame/processor.js';
import { tempDir, testConfig, writeJpeg } from './helpers.js';

const cases: [string, number, number, number?][] = [
  ['Querformat', 1600, 1200],
  ['Panorama', 2400, 800],
  ['Hochformat', 1200, 1600],
  ['EXIF gedreht', 1600, 1200, 6],
];

describe('renderFrameImage (FA-32)', async () => {
  const dir = await tempDir();
  for (const mode of ['crop', 'fill', 'crop+fill'] as const) {
    for (const [label, w, h, orientation] of cases) {
      it(`${mode}: ${label} ergibt 800 × 600, baseline, ohne EXIF`, async () => {
        const file = path.join(dir, `${label}.jpg`);
        await writeJpeg(file, w, h, orientation);
        const cfg = testConfig({ FIT_MODE: mode }).frame;
        const out = await renderFrameImage(await fs.readFile(file), cfg);
        const meta = await sharp(out).metadata();
        expect([meta.width, meta.height]).toEqual([800, 600]);
        expect(meta.format).toBe('jpeg');
        expect(meta.isProgressive).toBe(false);
        expect(meta.exif).toBeUndefined();
        expect(meta.orientation).toBeUndefined();
      });
    }
  }

  it('crop+fill schneidet höchstens den eingestellten Anteil weg', () => {
    const region = partialCropRegion({ width: 2400, height: 800 }, 4 / 3, 0.2)!;
    // Überstand 2400 - 1067 = 1333 px, davon 20 % ≈ 267 px weg
    expect(region.width).toBe(2133);
    expect(region.height).toBe(800);
    expect(partialCropRegion({ width: 800, height: 600 }, 4 / 3, 0.2)).toBeNull();
  });
});
