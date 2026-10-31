#!/usr/bin/env node
// Erzeugt einen Test-Bilderordner: 3 Jahre × 10 Ordner × 25 Dummy-JPEGs.
//
//   node scripts/create-test-photos.mjs [zielordner]   (Default: testdata/photos)
//
// Struktur: <ziel>/<jahr>/<yyyy-mm-dd>_<Titel>/<bild>.jpg
// Damit die Aufbereitung realistisch getestet wird, enthalten die Ordner
// gemischte Fälle: Hochformat, EXIF-Orientation 6 (Kamera hochkant gehalten),
// Dateiendungen .jpg/.JPG/.jpeg und Bilder in einem Unterordner.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const target = path.resolve(process.argv[2] ?? 'testdata/photos');
const IMAGES_PER_FOLDER = 25;

const YEARS = {
  2024: [
    ['01-06', 'Dreikönig'], ['02-10', 'Fasching'], ['03-31', 'Ostern'], ['04-28', 'Konfirmation'],
    ['05-18', 'Maiwanderung'], ['06-22', 'Sommerfest'], ['07-20', 'Norwegen Roadtrip'], ['09-07', 'Weinlese'],
    ['10-12', 'Umzug'], ['12-24', 'Weihnachten'],
  ],
  2025: [
    ['01-18', 'Winterspaziergang'], ['02-22', 'Skiurlaub Zillertal'], ['03-16', 'Geburtstag Paul'], ['05-01', 'Maibaum'],
    ['06-21', 'Sonnenwende'], ['07-12', 'Radtour Bodensee'], ['08-10', 'Toskana'], ['09-27', 'Herbstmarkt'],
    ['11-09', 'Laternenumzug'], ['12-31', 'Silvester'],
  ],
  2026: [
    ['01-01', 'Neujahr'], ['02-14', 'Valentinstag'], ['04-05', 'Ostern'], ['05-29', 'Pfingsten bei Oma'],
    ['06-13', 'Gartenparty'], ['07-11', 'Badesee'], ['08-22', 'Kroatien Urlaub'], ['09-14', 'Hochzeit Lena und Tom'],
    ['10-03', 'Grillabend'], ['10-18', 'Herbstwanderung Allgäu'],
  ],
};

const PALETTES = [
  ['#F7B98C', '#8C5D86'], ['#D3EEF7', '#1B5C80'], ['#E4F0DD', '#2D573A'], ['#C9D7E7', '#4C548A'],
  ['#F7ECD8', '#C99E62'], ['#FFD6E0', '#7A2E4F'], ['#E0E7FF', '#3D5AFE'], ['#FDE68A', '#B45309'],
];

function escapeXml(value) {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * SVG mit Verlauf, Titel und einem Pfeil „oben“: so sieht man im Rahmenbild
 * sofort, ob Rotation und Zuschnitt stimmen.
 */
function svg({ width, height, title, label, palette }) {
  const [from, to] = palette;
  const s = Math.min(width, height);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="${s * 0.04}" y="${s * 0.04}" width="${width - s * 0.08}" height="${height - s * 0.08}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="${s * 0.01}"/>
  <path d="M ${width / 2} ${s * 0.1} l ${s * 0.06} ${s * 0.09} h ${-s * 0.12} z" fill="#fff"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${s * 0.075}" fill="#fff">${escapeXml(title)}</text>
  <text x="50%" y="58%" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${s * 0.05}" fill="#fff" fill-opacity=".85">${escapeXml(label)}</text>
</svg>`);
}

async function writeImage(file, { portrait, exifRotated, title, label, palette }) {
  // Bei EXIF-Orientation 6 liegen die Pixel quer und werden erst beim
  // Anzeigen um 90° gedreht – das SVG wird deshalb vorab gegengedreht.
  const shown = portrait ? { width: 1200, height: 1600 } : { width: 1600, height: 1200 };
  let image = sharp(svg({ ...shown, title, label, palette }));
  if (exifRotated) image = sharp(await image.rotate(-90).png().toBuffer()).withMetadata({ orientation: 6 });
  await image.jpeg({ quality: 72 }).toFile(file);
}

async function main() {
  await fs.mkdir(target, { recursive: true });
  let folders = 0;
  let images = 0;
  let folderIndex = 0;

  for (const [year, entries] of Object.entries(YEARS)) {
    for (const [monthDay, title] of entries) {
      const name = `${year}-${monthDay}_${title.replaceAll(' ', '_')}`;
      const dir = path.join(target, year, name);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      const palette = PALETTES[folderIndex % PALETTES.length];
      // Jeder dritte Ordner legt einen Teil der Bilder in einen Unterordner.
      const nested = folderIndex % 3 === 1;

      for (let i = 1; i <= IMAGES_PER_FOLDER; i += 1) {
        const number = String(i).padStart(3, '0');
        const ext = i % 7 === 0 ? 'JPG' : i % 11 === 0 ? 'jpeg' : 'jpg';
        const sub = nested && i > 15 ? 'Handy' : '';
        const file = path.join(dir, sub, `IMG_${number}.${ext}`);
        if (sub) await fs.mkdir(path.dirname(file), { recursive: true });
        await writeImage(file, {
          portrait: i % 5 === 0,
          exifRotated: i % 8 === 0,
          title,
          label: `${monthDay.split('-').reverse().join('.')}.${year} · Bild ${i}/${IMAGES_PER_FOLDER}${sub ? ` · ${sub}` : ''}`,
          palette,
        });
        images += 1;
      }
      folders += 1;
      folderIndex += 1;
      process.stdout.write(`\r${folders} Ordner, ${images} Bilder`);
    }
  }
  process.stdout.write(`\nFertig: ${target}\n`);
}

await main();
