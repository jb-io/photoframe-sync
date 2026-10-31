#!/usr/bin/env node
// Screenshots der laufenden Oberfläche (mobil und Desktop, hell und dunkel).
//
//   node scripts/screenshots.mjs [url] [zielordner]
//   Default: http://localhost:8080  docs/screenshots
//
/* global document */
// Nutzt das installierte Google Chrome (Playwright-Kanal "chrome").
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:8080';
const outDir = path.resolve(process.argv[3] ?? 'docs/screenshots');

const SHOTS = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, scheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1440, height: 1000 }, scheme: 'dark' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, scheme: 'light', mobile: true },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, scheme: 'dark', mobile: true },
  // Ansichten nach einer Bedienung – es wird nichts gespeichert
  {
    name: 'desktop-manual',
    viewport: { width: 1440, height: 1000 },
    scheme: 'light',
    action: async (page) => {
      await page.getByRole('radio', { name: /Manuell/ }).click();
      await page.locator('.tile.sel').first().click();
    },
  },
  {
    name: 'mobile-transfer',
    viewport: { width: 390, height: 844 },
    scheme: 'light',
    mobile: true,
    action: async (page) => {
      await page.getByRole('button', { name: /Übertragung/ }).click();
      await page.getByRole('radio', { name: /Begrenzt pro Ordner/ }).click();
      await page.getByRole('button', { name: '25', exact: true }).click();
    },
  },
];

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      colorScheme: shot.scheme,
      deviceScaleFactor: 2,
      isMobile: Boolean(shot.mobile),
      hasTouch: Boolean(shot.mobile),
      locale: 'de-DE',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app.m, .app.d');
    if (shot.action) await shot.action(page);
    // Alle sichtbaren Vorschauen abwarten
    await page.waitForFunction(() => document.querySelectorAll('.ph.loading').length === 0, null, { timeout: 15000 }).catch(() => {});
    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await context.close();
  }
} finally {
  await browser.close();
}
