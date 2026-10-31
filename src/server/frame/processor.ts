import sharp, { type Metadata, type Sharp } from 'sharp';
import type { Config } from '../config.js';

// Bildaufbereitung wie in photorahmen (FA-32): EXIF-Rotation, Zuschnitt per
// FIT_MODE, Verkleinerung auf die Zielgröße, JPEG ohne Metadaten.
// Hochkantbilder werden nicht zusätzlich gedreht (FA-34).

type FrameConfig = Config['frame'];

const GRAVITY = {
  center: sharp.gravity.centre,
  attention: sharp.strategy.attention,
  entropy: sharp.strategy.entropy,
} as const;

interface Size {
  width: number;
  height: number;
}

interface Region extends Size {
  left: number;
  top: number;
}

/** Maße nach Anwendung der EXIF-Orientation. */
function orientedSize(meta: Metadata): Size {
  const swap = (meta.orientation ?? 1) >= 5;
  return swap ? { width: meta.height!, height: meta.width! } : { width: meta.width!, height: meta.height! };
}

/**
 * Zuschnittfenster für crop+fill: schneidet höchstens maxRatio des Überstands
 * weg, der Rest wird mit Hintergrund aufgefüllt.
 */
export function partialCropRegion({ width, height }: Size, targetAspect: number, maxRatio: number): Region | null {
  const aspect = width / height;
  if (Math.abs(aspect - targetAspect) < 0.001 || maxRatio <= 0) return null;
  if (aspect > targetAspect) {
    const coverWidth = height * targetAspect;
    const cropped = Math.round(width - maxRatio * (width - coverWidth));
    if (cropped >= width) return null;
    return { left: Math.round((width - cropped) / 2), top: 0, width: cropped, height };
  }
  const coverHeight = width / targetAspect;
  const cropped = Math.round(height - maxRatio * (height - coverHeight));
  if (cropped >= height) return null;
  return { left: 0, top: Math.round((height - cropped) / 2), width, height: cropped };
}

function jpeg(image: Sharp, cfg: FrameConfig): Promise<Buffer> {
  // Ohne withMetadata() entfernt sharp EXIF & Co. Baseline-JPEG, weil einfache
  // Rahmen progressive JPEGs oft nicht anzeigen – deshalb nicht `mozjpeg: true`
  // (schaltet optimiseScans und damit progressive ein), sondern nur dessen
  // Kompressionsoptionen.
  return image
    .jpeg({
      quality: cfg.jpegQuality,
      progressive: false,
      optimiseScans: false,
      trellisQuantisation: true,
      overshootDeringing: true,
      quantisationTable: 3,
    })
    .toBuffer();
}

async function renderCover(input: Buffer, cfg: FrameConfig): Promise<Buffer> {
  return jpeg(
    sharp(input).rotate().resize(cfg.width, cfg.height, { fit: 'cover', position: GRAVITY[cfg.cropGravity] }),
    cfg,
  );
}

/** Bild vollständig einpassen, Rand mit Farbe oder unscharfer Kopie füllen. */
async function renderContain(input: Buffer, region: Region | null, cfg: FrameConfig): Promise<Buffer> {
  // Erst rotieren und materialisieren, damit extract() in Anzeige-Koordinaten arbeitet.
  const upright = await sharp(input).rotate().toBuffer();
  const base = () => (region ? sharp(upright).extract(region) : sharp(upright));

  const foreground = await base().resize(cfg.width, cfg.height, { fit: 'inside' }).toBuffer();

  let background: Sharp;
  if (cfg.fillBackground.type === 'blur') {
    const sigma = Math.max(8, Math.min(cfg.width, cfg.height) / 20);
    background = sharp(
      await base()
        .resize(cfg.width, cfg.height, { fit: 'cover', position: 'centre' })
        .blur(sigma)
        .modulate({ brightness: 0.75 })
        .toBuffer(),
    );
  } else {
    background = sharp({
      create: { width: cfg.width, height: cfg.height, channels: 3, background: cfg.fillBackground.color },
    });
  }
  return jpeg(background.composite([{ input: foreground, gravity: 'centre' }]), cfg);
}

/** Ein Original in ein Rahmenbild umwandeln. */
export async function renderFrameImage(input: Buffer, cfg: FrameConfig): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('Bild hat keine lesbaren Maße');
  const size = orientedSize(meta);
  const targetAspect = cfg.width / cfg.height;
  const matches = Math.abs(size.width / size.height - targetAspect) < 0.001;

  if (cfg.fitMode === 'crop' || matches) return renderCover(input, cfg);
  if (cfg.fitMode === 'fill') return renderContain(input, null, cfg);
  return renderContain(input, partialCropRegion(size, targetAspect, cfg.cropMaxRatio), cfg);
}

/** Verkleinerte Vorschau für die Ordnerkachel. */
export async function renderThumb(input: Buffer, size: number): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}
