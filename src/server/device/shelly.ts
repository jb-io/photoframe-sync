import { createHash, randomBytes } from 'node:crypto';

// Lokale RPC-API des Shelly Plug Gen3 (Switch.Set / Switch.GetStatus).
// Authentifizierung ist optional; Shelly Gen2+ nutzt Digest mit SHA-256 und
// dem festen Benutzer "admin".

const TIMEOUT_MS = 4000;

export class ShellyError extends Error {}

export interface ShellyOptions {
  ip: string;
  switchId: number;
  password?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) out[match[1]!] = match[2] ?? match[3] ?? '';
  return out;
}

export class Shelly {
  constructor(private opts: ShellyOptions) {}

  private digest(challenge: string, uri: string): string {
    const c = parseChallenge(challenge);
    const cnonce = randomBytes(8).toString('hex');
    const nc = '00000001';
    const ha1 = sha256(`admin:${c.realm}:${this.opts.password}`);
    const ha2 = sha256(`GET:${uri}`);
    const response = sha256(`${ha1}:${c.nonce}:${nc}:${cnonce}:auth:${ha2}`);
    return `Digest username="admin", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", algorithm=SHA-256, qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  }

  private async rpc<T>(method: string, params: Record<string, string | number | boolean>): Promise<T> {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString();
    const uri = `/rpc/${method}?${query}`;
    const url = `http://${this.opts.ip}${uri}`;
    try {
      let response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 401) {
        const challenge = response.headers.get('www-authenticate');
        if (!this.opts.password || !challenge) throw new ShellyError('Shelly verlangt ein Passwort (SHELLY_PASSWORD)');
        response = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Authorization: this.digest(challenge, uri) },
        });
      }
      if (!response.ok) throw new ShellyError(`${method} → HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ShellyError) throw err;
      throw new ShellyError(`Shelly nicht erreichbar (${(err as Error).message})`);
    }
  }

  /** Aktueller Schaltzustand. */
  async getPower(): Promise<boolean> {
    const status = await this.rpc<{ output: boolean }>('Switch.GetStatus', { id: this.opts.switchId });
    return Boolean(status.output);
  }

  async setPower(on: boolean): Promise<void> {
    await this.rpc('Switch.Set', { id: this.opts.switchId, on });
  }

  /**
   * Aus- und nach `offSec` wieder einschalten. Das Wiedereinschalten übernimmt
   * der Shelly selbst (toggle_after) – der Rahmen kommt also auch dann zurück,
   * wenn die App zwischendurch neu startet.
   */
  async restart(offSec: number): Promise<void> {
    await this.rpc('Switch.Set', { id: this.opts.switchId, on: false, toggle_after: offSec });
  }
}
