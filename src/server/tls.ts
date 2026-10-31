import { createPrivateKey, X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { generate } from 'selfsigned';
import type { Config } from './config.js';
import type { Logger } from './log.js';

// Zertifikat für HTTPS: entweder eigene Dateien (TLS_CERT_FILE/TLS_KEY_FILE)
// oder ein selbstsigniertes, das unter /data/tls liegt und wiederverwendet wird.

const SELF_SIGNED_DAYS = 3650;
/** So lange vor Ablauf wird ein selbstsigniertes Zertifikat erneuert */
const RENEW_BEFORE_DAYS = 30;

export interface TlsMaterial {
  key: string;
  cert: string;
  source: 'files' | 'selfsigned';
  /** Gültig bis (ISO) */
  validTo: string;
  /** Namen und IPs, für die das Zertifikat gilt */
  names: string[];
  fingerprint: string;
}

export class TlsError extends Error {}

function describe(cert: string): Pick<TlsMaterial, 'validTo' | 'names' | 'fingerprint'> {
  const x509 = new X509Certificate(cert);
  const names = (x509.subjectAltName ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^(DNS|IP Address):/, ''))
    .filter(Boolean);
  return { validTo: new Date(x509.validTo).toISOString(), names, fingerprint: x509.fingerprint256 };
}

/**
 * Namen für das selbstsignierte Zertifikat: TLS_HOSTNAMES plus localhost.
 * Bewusst ohne os.hostname(): Im Container ist das die Container-ID, die sich
 * bei jedem Update ändert – das Zertifikat (und die Browser-Ausnahme) soll bleiben.
 */
/**
 * Namen vergleichbar machen: Node schreibt IPv6 im Zertifikat ausgeschrieben
 * und groß (FD00:0:0:…), in TLS_HOSTNAMES steht meist die Kurzform (fd00::5).
 */
export function normalizeName(name: string): string {
  const n = name.trim().toLowerCase();
  return isIP(n) === 6 ? new URL(`http://[${n}]`).hostname.slice(1, -1) : n;
}

export function selfSignedNames(extra: string[]): string[] {
  return [...new Set([...extra, 'localhost', '127.0.0.1'].map((n) => n.trim()).filter(Boolean))];
}

async function readFiles(certFile: string, keyFile: string): Promise<{ cert: string; key: string }> {
  try {
    const [cert, key] = await Promise.all([fs.readFile(certFile, 'utf8'), fs.readFile(keyFile, 'utf8')]);
    return { cert, key };
  } catch (err) {
    throw new TlsError(`Zertifikat nicht lesbar: ${(err as Error).message}`);
  }
}

async function selfSigned(dir: string, names: string[], log: Logger): Promise<TlsMaterial> {
  const certFile = path.join(dir, 'selfsigned-cert.pem');
  const keyFile = path.join(dir, 'selfsigned-key.pem');

  // Vorhandenes Zertifikat weiterverwenden: Die Browser-Ausnahme bleibt so gültig.
  try {
    const existing = await readFiles(certFile, keyFile);
    const info = describe(existing.cert);
    const fresh = Date.parse(info.validTo) - Date.now() > RENEW_BEFORE_DAYS * 86_400_000;
    const present = new Set(info.names.map(normalizeName));
    const covers = names.every((n) => present.has(normalizeName(n)));
    if (fresh && covers) return { ...existing, ...info, source: 'selfsigned' };
    log.info({ validTo: info.validTo, names: info.names }, 'Selbstsigniertes Zertifikat wird erneuert');
  } catch {
    // noch keins vorhanden
  }

  const notBeforeDate = new Date(Date.now() - 86_400_000);
  const notAfterDate = new Date(Date.now() + SELF_SIGNED_DAYS * 86_400_000);
  const pems = await generate([{ name: 'commonName', value: names[0] ?? 'photoframe-sync' }, { name: 'organizationName', value: 'Bilderrahmen Sync' }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: names.map((n) => (isIP(n) ? { type: 7 as const, ip: n } : { type: 2 as const, value: n })),
      },
    ],
  });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(keyFile, pems.private, { mode: 0o600 });
  await fs.writeFile(certFile, pems.cert);
  const info = describe(pems.cert);
  log.info({ validTo: info.validTo, names: info.names, fingerprint: info.fingerprint }, 'Selbstsigniertes Zertifikat erzeugt');
  return { key: pems.private, cert: pems.cert, ...info, source: 'selfsigned' };
}

/** Zertifikat laden bzw. erzeugen. */
export async function loadTls(cfg: Config, log: Logger): Promise<TlsMaterial> {
  const { certFile, keyFile, hostnames } = cfg.https;
  if (certFile && keyFile) {
    const files = await readFiles(certFile, keyFile);
    let info;
    try {
      info = describe(files.cert);
    } catch (err) {
      throw new TlsError(`TLS_CERT_FILE ist kein gültiges PEM-Zertifikat: ${(err as Error).message}`);
    }
    let matches: boolean;
    try {
      matches = new X509Certificate(files.cert).checkPrivateKey(createPrivateKey(files.key));
    } catch (err) {
      throw new TlsError(`TLS_KEY_FILE ist kein gültiger privater Schlüssel: ${(err as Error).message}`);
    }
    if (!matches) throw new TlsError('TLS_KEY_FILE passt nicht zu TLS_CERT_FILE');
    return { ...files, ...info, source: 'files' };
  }
  return selfSigned(path.join(cfg.dataDir, 'tls'), selfSignedNames(hostnames), log);
}

/**
 * Eigene Zertifikatsdateien beobachten (z. B. Erneuerung durch Let's Encrypt)
 * und bei Änderung `onChange` aufrufen. Liefert eine Stopp-Funktion.
 */
export function watchCertFiles(cfg: Config, log: Logger, onChange: (tls: TlsMaterial) => void, intervalMs = 10 * 60_000): () => void {
  const { certFile, keyFile } = cfg.https;
  if (!certFile || !keyFile) return () => {};
  let last = '';
  const stamp = async () => {
    const [a, b] = await Promise.all([fs.stat(certFile), fs.stat(keyFile)]);
    return `${a.mtimeMs}/${b.mtimeMs}`;
  };
  void stamp().then((s) => (last = s)).catch(() => {});
  const timer = setInterval(async () => {
    try {
      const now = await stamp();
      if (now === last) return;
      last = now;
      const tls = await loadTls(cfg, log);
      log.info({ validTo: tls.validTo }, 'Zertifikat neu geladen');
      onChange(tls);
    } catch (err) {
      log.warn({ err }, 'Zertifikat konnte nicht neu geladen werden');
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
