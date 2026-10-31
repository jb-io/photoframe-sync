import { createHash } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
    ctx.addIssue({ code: 'custom', message: 'erwartet true oder false' });
    return z.NEVER;
  });

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const optionalString = z
  .string()
  .trim()
  .transform((v) => v || undefined)
  .optional();

const schema = z.object({
  PORT: int(1, 65535).default(8080),
  PHOTOS_DIR: z.string().default('/photos'),
  DATA_DIR: z.string().default('/data'),
  CACHE_DIR: z.string().default('/cache'),
  SCAN_INTERVAL_SEC: int(30, 7 * 24 * 3600).default(3600),
  THUMB_SIZE: int(64, 2048).default(480),
  THUMB_CONCURRENCY: int(1, 16).default(2),

  FLASHAIR_IP: optionalString,
  FLASHAIR_USER: optionalString,
  FLASHAIR_PASSWORD: optionalString,
  FLASHAIR_DIR: z
    .string()
    .trim()
    .default('/')
    .refine((v) => v.startsWith('/'), 'muss mit / beginnen'),
  REACHABILITY_INTERVAL_SEC: int(5, 3600).default(60),
  SYNC_DELETE_EXTRA: bool.default(true),
  NAMING: z.enum(['dcim', 'original']).default('dcim'),
  NAMING_ORDER: z.enum(['original', 'random']).default('random'),

  TARGET_WIDTH: int(16, 8000).default(800),
  TARGET_HEIGHT: int(16, 8000).default(600),
  FIT_MODE: z.enum(['crop', 'fill', 'crop+fill']).default('crop'),
  FILL_BACKGROUND: z
    .string()
    .trim()
    .default('blur')
    .refine((v) => v === 'blur' || /^#?[0-9a-f]{6}$/i.test(v), 'blur oder Hex-Farbe (#RRGGBB)'),
  CROP_GRAVITY: z.enum(['center', 'attention', 'entropy']).default('attention'),
  CROP_MAX_RATIO: z.coerce.number().min(0).max(1).default(0.2),
  JPEG_QUALITY: int(1, 100).default(88),

  SHELLY_IP: optionalString,
  SHELLY_SWITCH_ID: int(0, 16).default(0),
  SHELLY_PASSWORD: optionalString,
  POWER_ON_SYNC_DELAY_SEC: int(0, 3600).default(30),
  BOOT_TIMEOUT_SEC: int(5, 3600).default(120),
  RESTART_AFTER_SYNC: bool.default(true),
  RESTART_OFF_SEC: int(1, 300).default(5),
  RESTART_DELAY_SEC: int(0, 600).default(10),
  WEBHOOK_TOKEN: optionalString,

  HTTPS_ENABLED: bool.default(false),
  HTTPS_PORT: int(1, 65535).default(8443),
  /** Von außen erreichbarer HTTPS-Port für die Umleitung, falls er vom Container-Port abweicht */
  HTTPS_PUBLIC_PORT: int(1, 65535).optional(),
  TLS_CERT_FILE: optionalString,
  TLS_KEY_FILE: optionalString,
  /** Zusätzliche Namen/IPs für das selbstsignierte Zertifikat, kommagetrennt */
  TLS_HOSTNAMES: optionalString,
  HTTP_REDIRECT: bool.default(true),

  TZ: z.string().default('Europe/Berlin'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** Erhöhen, wenn sich die Aufbereitung ändert: erzwingt neue Rahmenbilder. */
const FRAME_ENCODER_VERSION = 2;

export type FitMode = 'crop' | 'fill' | 'crop+fill';
export type FillBackground = { type: 'blur' } | { type: 'color'; color: string };

export interface Config {
  port: number;
  https: {
    enabled: boolean;
    port: number;
    /** Ziel der HTTP→HTTPS-Umleitung (Standard: port) */
    publicPort: number;
    certFile?: string;
    keyFile?: string;
    hostnames: string[];
    /** Oberfläche über HTTP auf HTTPS umleiten (Webhook und Healthcheck nicht) */
    redirect: boolean;
  };
  photosDir: string;
  dataDir: string;
  cacheDir: string;
  scanIntervalSec: number;
  thumbSize: number;
  thumbConcurrency: number;
  flashair: {
    ip?: string;
    user?: string;
    password?: string;
    dir: string;
    reachabilityIntervalSec: number;
    deleteExtra: boolean;
  };
  naming: 'dcim' | 'original';
  namingOrder: 'original' | 'random';
  frame: {
    width: number;
    height: number;
    fitMode: FitMode;
    fillBackground: FillBackground;
    cropGravity: 'center' | 'attention' | 'entropy';
    cropMaxRatio: number;
    jpegQuality: number;
  };
  /** Hash über alle Einstellungen, die das Rahmenbild beeinflussen */
  frameConfigHash: string;
  shelly: {
    ip?: string;
    switchId: number;
    password?: string;
  };
  powerOnSyncDelaySec: number;
  bootTimeoutSec: number;
  /** Rahmen nach einem Sync mit Änderungen aus- und wieder einschalten */
  restartAfterSync: boolean;
  /** Wie lange der Rahmen beim Neustart aus bleibt */
  restartOffSec: number;
  /** Wartezeit zwischen Sync-Ende und Neustart, damit die Karte fertig schreiben kann */
  restartDelaySec: number;
  webhookToken?: string;
  timeZone: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Leere Variablen aus .env-Dateien gelten als nicht gesetzt.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Ungültige Konfiguration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  if (Boolean(e.TLS_CERT_FILE) !== Boolean(e.TLS_KEY_FILE)) {
    throw new ConfigError('Ungültige Konfiguration:\n  TLS_CERT_FILE und TLS_KEY_FILE nur gemeinsam setzen');
  }
  if (e.HTTPS_ENABLED && e.HTTPS_PORT === e.PORT) {
    throw new ConfigError('Ungültige Konfiguration:\n  HTTPS_PORT muss sich von PORT unterscheiden');
  }

  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: e.TZ });
  } catch {
    throw new ConfigError(`Ungültige Konfiguration:\n  TZ: unbekannte Zeitzone "${e.TZ}"`);
  }

  const fillBackground: FillBackground =
    e.FILL_BACKGROUND === 'blur'
      ? { type: 'blur' }
      : { type: 'color', color: e.FILL_BACKGROUND.startsWith('#') ? e.FILL_BACKGROUND : `#${e.FILL_BACKGROUND}` };

  const frame = {
    width: e.TARGET_WIDTH,
    height: e.TARGET_HEIGHT,
    fitMode: e.FIT_MODE,
    fillBackground,
    cropGravity: e.CROP_GRAVITY,
    cropMaxRatio: e.CROP_MAX_RATIO,
    jpegQuality: e.JPEG_QUALITY,
  };

  return {
    port: e.PORT,
    https: {
      enabled: e.HTTPS_ENABLED,
      port: e.HTTPS_PORT,
      publicPort: e.HTTPS_PUBLIC_PORT ?? e.HTTPS_PORT,
      certFile: e.TLS_CERT_FILE,
      keyFile: e.TLS_KEY_FILE,
      hostnames: (e.TLS_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean),
      redirect: e.HTTP_REDIRECT,
    },
    photosDir: e.PHOTOS_DIR,
    dataDir: e.DATA_DIR,
    cacheDir: e.CACHE_DIR,
    scanIntervalSec: e.SCAN_INTERVAL_SEC,
    thumbSize: e.THUMB_SIZE,
    thumbConcurrency: e.THUMB_CONCURRENCY,
    flashair: {
      ip: e.FLASHAIR_IP,
      user: e.FLASHAIR_USER,
      password: e.FLASHAIR_PASSWORD,
      dir: e.FLASHAIR_DIR.length > 1 ? e.FLASHAIR_DIR.replace(/\/+$/, '') : '/',
      reachabilityIntervalSec: e.REACHABILITY_INTERVAL_SEC,
      deleteExtra: e.SYNC_DELETE_EXTRA,
    },
    naming: e.NAMING,
    namingOrder: e.NAMING_ORDER,
    frame,
    frameConfigHash: createHash('sha1')
      .update(`${FRAME_ENCODER_VERSION}:${JSON.stringify(frame)}`)
      .digest('hex')
      .slice(0, 10),
    shelly: {
      ip: e.SHELLY_IP,
      switchId: e.SHELLY_SWITCH_ID,
      password: e.SHELLY_PASSWORD,
    },
    powerOnSyncDelaySec: e.POWER_ON_SYNC_DELAY_SEC,
    bootTimeoutSec: e.BOOT_TIMEOUT_SEC,
    restartAfterSync: e.RESTART_AFTER_SYNC,
    restartOffSec: e.RESTART_OFF_SEC,
    restartDelaySec: e.RESTART_DELAY_SEC,
    webhookToken: e.WEBHOOK_TOKEN,
    timeZone: e.TZ,
    logLevel: e.LOG_LEVEL,
  };
}
