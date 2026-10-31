// HTTP-Client für die Toshiba FlashAir W-03 (command.cgi / upload.cgi).

const TIMEOUT_FAST_MS = 4000;
const TIMEOUT_UPLOAD_MS = 120_000;

// FAT-Attributbits aus der Antwort von op=100
const ATTR_READONLY = 0x01;
const ATTR_HIDDEN = 0x02;
const ATTR_SYSTEM = 0x04;
const ATTR_DIRECTORY = 0x10;

export class FlashAirError extends Error {}

export interface CardFile {
  name: string;
  size: number;
  attributes: number;
  /** Schreibgeschützt, versteckt oder System: fasst der Sync nie an (FA-29) */
  protected: boolean;
}

export interface FlashAirOptions {
  ip: string;
  user?: string;
  password?: string;
  dir: string;
}

/** Antwort von op=100 zerlegen: "<dir>,<name>,<size>,<attribut>,<datum>,<zeit>" */
export function parseFileList(raw: string): CardFile[] {
  const files: CardFile[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('WLANSD_FILELIST')) continue;
    const parts = trimmed.split(',');
    if (parts.length < 6) continue;
    const attributes = Number(parts.at(-3));
    const size = Number(parts.at(-4));
    // Dateinamen dürfen Kommas enthalten: alles zwischen Verzeichnis und den
    // vier festen Feldern am Ende gehört zum Namen.
    const name = parts.slice(1, -4).join(',');
    if (!name) continue;
    const flags = Number.isFinite(attributes) ? attributes : 0;
    // Verzeichnisse werden nie aufgelistet, damit sie in keiner Lösch- oder
    // Upload-Liste landen können.
    if ((flags & ATTR_DIRECTORY) !== 0) continue;
    files.push({
      name,
      size: Number.isFinite(size) ? size : 0,
      attributes: flags,
      protected: (flags & (ATTR_READONLY | ATTR_HIDDEN | ATTR_SYSTEM)) !== 0 || name.startsWith('.'),
    });
  }
  return files;
}

/** Zeitstempel im FAT-Format für upload.cgi?FTIME= */
export function fatTime(date: Date): number {
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return ((day << 16) >>> 0) + time;
}

export class FlashAir {
  private base: string;
  private auth?: string;

  constructor(private opts: FlashAirOptions) {
    this.base = `http://${opts.ip}`;
    if (opts.user || opts.password) {
      this.auth = `Basic ${Buffer.from(`${opts.user ?? ''}:${opts.password ?? ''}`).toString('base64')}`;
    }
  }

  get dir(): string {
    return this.opts.dir;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.auth ? { ...extra, Authorization: this.auth } : extra;
  }

  private async get(pathAndQuery: string, timeoutMs = TIMEOUT_FAST_MS): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${pathAndQuery}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: this.headers({ Connection: 'close' }),
      });
    } catch (err) {
      throw new FlashAirError(`Karte nicht erreichbar (${(err as Error).message})`);
    }
    if (response.status === 401) throw new FlashAirError('HTTP 401: FLASHAIR_USER/FLASHAIR_PASSWORD passen nicht');
    if (!response.ok) throw new FlashAirError(`${pathAndQuery.split('?')[0]} → HTTP ${response.status}`);
    return (await response.text()).trim();
  }

  private assertSuccess(body: string, what: string): void {
    if (/SUCCESS/i.test(body)) return;
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new FlashAirError(`${what} fehlgeschlagen: ${text}`);
  }

  /** Erreichbarkeit (FA-35): liefert die Firmware-Version. */
  firmwareVersion(): Promise<string> {
    return this.get('/command.cgi?op=108');
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.firmwareVersion();
      return true;
    } catch {
      return false;
    }
  }

  /** Freier und gesamter Speicher in Bytes. Antwort: "<frei>/<gesamt>,<Sektorgröße>" */
  async space(): Promise<{ freeBytes: number; totalBytes: number }> {
    const raw = await this.get('/command.cgi?op=140', 15_000);
    const match = /(\d+)\/(\d+),(\d+)/.exec(raw);
    if (!match) throw new FlashAirError(`Unerwartete Antwort auf op=140: ${raw}`);
    const [, free, total, sector] = match.map(Number) as [number, number, number, number];
    return { freeBytes: free * sector, totalBytes: total * sector };
  }

  /** Dateien direkt im Zielordner, ohne Unterordner. */
  async list(): Promise<CardFile[]> {
    return parseFileList(await this.get(`/command.cgi?op=100&DIR=${encodeURIComponent(this.opts.dir)}`, 15_000));
  }

  /** Schreibzugriff vorbereiten (idempotent, vor jedem Sync). */
  async prepareUpload(now = new Date()): Promise<void> {
    this.assertSuccess(await this.get('/upload.cgi?WRITEPROTECT=ON'), 'WRITEPROTECT=ON');
    this.assertSuccess(await this.get(`/upload.cgi?FTIME=0x${fatTime(now).toString(16)}`), 'FTIME');
    this.assertSuccess(await this.get(`/upload.cgi?UPDIR=${encodeURIComponent(this.opts.dir)}`), 'UPDIR');
  }

  async upload(name: string, data: Buffer): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: 'image/jpeg' }), name);
    let response: Response;
    try {
      response = await fetch(`${this.base}/upload.cgi`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_UPLOAD_MS),
        headers: this.headers(),
      });
    } catch (err) {
      throw new FlashAirError(`Upload ${name}: ${(err as Error).message}`);
    }
    if (!response.ok) throw new FlashAirError(`Upload ${name} → HTTP ${response.status}`);
    this.assertSuccess(await response.text(), `Upload ${name}`);
  }

  /**
   * Eine Datei direkt im Zielordner löschen. Nur einfache Dateinamen: So kann
   * nie in einen Unterordner hinein gelöscht werden.
   */
  async remove(name: string): Promise<void> {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw new FlashAirError(`Löschen abgelehnt: "${name}" ist kein einfacher Dateiname`);
    }
    const target = `${this.opts.dir}/${name}`.replace(/\/+/g, '/');
    this.assertSuccess(await this.get(`/upload.cgi?DEL=${encodeURIComponent(target)}`, 15_000), `Löschen ${target}`);
  }
}
