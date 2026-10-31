import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { pino } from 'pino';
import { loadConfig } from '../src/server/config.js';

export const silentLog = pino({ level: 'silent' });

export async function tempDir(prefix = 'pfs-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export function testConfig(env: Record<string, string>) {
  return loadConfig({ TZ: 'Europe/Berlin', ...env });
}

/** Kleines JPEG mit Farbverlauf; optional mit EXIF-Orientation. */
export async function writeJpeg(file: string, width: number, height: number, orientation?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  let img = sharp(Buffer.from(svg));
  if (orientation) img = img.withMetadata({ orientation });
  await img.jpeg({ quality: 70 }).toFile(file);
}
