import { X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { ConfigError, loadConfig } from '../src/server/config.js';
import { Core } from '../src/server/core.js';
import { Store } from '../src/server/db.js';
import { loadTls, normalizeName } from '../src/server/tls.js';
import { silentLog, tempDir, testConfig } from './helpers.js';

const YEAR_MS = 365 * 86_400_000;

describe('Konfiguration HTTPS', () => {
  it('ist standardmäßig aus', () => {
    expect(loadConfig({}).https).toMatchObject({ enabled: false, port: 8443, redirect: true, hostnames: [] });
  });

  it('verlangt Zertifikat und Schlüssel nur gemeinsam', () => {
    expect(() => loadConfig({ TLS_CERT_FILE: '/certs/cert.pem' })).toThrow(ConfigError);
  });

  it('leitet auf HTTPS_PUBLIC_PORT um, sonst auf HTTPS_PORT', () => {
    expect(loadConfig({}).https.publicPort).toBe(8443);
    expect(loadConfig({ HTTPS_PUBLIC_PORT: '9443' }).https.publicPort).toBe(9443);
  });

  it('liest TLS_HOSTNAMES als Liste', () => {
    expect(loadConfig({ TLS_HOSTNAMES: 'rahmen.local, 192.168.1.10 ,' }).https.hostnames).toEqual(['rahmen.local', '192.168.1.10']);
  });
});

describe('Selbstsigniertes Zertifikat', () => {
  it('wird für 10 Jahre mit allen Namen erzeugt und danach wiederverwendet', async () => {
    const data = await tempDir();
    const cfg = testConfig({ DATA_DIR: data, HTTPS_ENABLED: 'true', TLS_HOSTNAMES: 'rahmen.local,192.168.1.10' });
    const first = await loadTls(cfg, silentLog);

    expect(first.source).toBe('selfsigned');
    const lifetime = Date.parse(first.validTo) - Date.now();
    expect(lifetime).toBeGreaterThan(9.9 * YEAR_MS);
    expect(lifetime).toBeLessThan(10.1 * YEAR_MS);
    expect(first.names).toEqual(expect.arrayContaining(['rahmen.local', '192.168.1.10', 'localhost', '127.0.0.1']));
    expect(new X509Certificate(first.cert).checkPrivateKey((await import('node:crypto')).createPrivateKey(first.key))).toBe(true);

    const stat = await fs.stat(path.join(data, 'tls/selfsigned-key.pem'));
    expect(stat.mode & 0o077).toBe(0);

    const second = await loadTls(cfg, silentLog);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('wird auch mit IPv6-Kurzschreibweise wiederverwendet', async () => {
    expect(normalizeName('FD00:0:0:0:0:0:0:5')).toBe(normalizeName('fd00::5'));
    const data = await tempDir();
    const cfg = testConfig({ DATA_DIR: data, HTTPS_ENABLED: 'true', TLS_HOSTNAMES: 'fd00::5,Rahmen.Local' });
    const a = await loadTls(cfg, silentLog);
    const b = await loadTls(cfg, silentLog);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('wird neu erzeugt, wenn ein Name dazukommt', async () => {
    const data = await tempDir();
    const a = await loadTls(testConfig({ DATA_DIR: data, HTTPS_ENABLED: 'true' }), silentLog);
    const b = await loadTls(testConfig({ DATA_DIR: data, HTTPS_ENABLED: 'true', TLS_HOSTNAMES: 'neu.local' }), silentLog);
    expect(b.fingerprint).not.toBe(a.fingerprint);
    expect(b.names).toContain('neu.local');
  });

  it('eigene Dateien haben Vorrang', async () => {
    const data = await tempDir();
    const generated = await loadTls(testConfig({ DATA_DIR: data, HTTPS_ENABLED: 'true', TLS_HOSTNAMES: 'eigen.example' }), silentLog);
    const certs = await tempDir();
    await fs.writeFile(path.join(certs, 'cert.pem'), generated.cert);
    await fs.writeFile(path.join(certs, 'key.pem'), generated.key);
    const own = await loadTls(
      testConfig({ DATA_DIR: await tempDir(), HTTPS_ENABLED: 'true', TLS_CERT_FILE: path.join(certs, 'cert.pem'), TLS_KEY_FILE: path.join(certs, 'key.pem') }),
      silentLog,
    );
    expect(own.source).toBe('files');
    expect(own.fingerprint).toBe(generated.fingerprint);
  });

  it('erkennt einen Schlüssel, der nicht zum Zertifikat passt', async () => {
    const a = await loadTls(testConfig({ DATA_DIR: await tempDir(), HTTPS_ENABLED: 'true' }), silentLog);
    const b = await loadTls(testConfig({ DATA_DIR: await tempDir(), HTTPS_ENABLED: 'true' }), silentLog);
    const certs = await tempDir();
    await fs.writeFile(path.join(certs, 'cert.pem'), a.cert);
    await fs.writeFile(path.join(certs, 'key.pem'), b.key);
    const cfg = testConfig({ HTTPS_ENABLED: 'true', TLS_CERT_FILE: path.join(certs, 'cert.pem'), TLS_KEY_FILE: path.join(certs, 'key.pem') });
    await expect(loadTls(cfg, silentLog)).rejects.toThrow('TLS_KEY_FILE passt nicht zu TLS_CERT_FILE');
  });

  it('meldet fehlende Dateien verständlich', async () => {
    const cfg = testConfig({ HTTPS_ENABLED: 'true', TLS_CERT_FILE: '/gibt/es/nicht.pem', TLS_KEY_FILE: '/gibt/es/nicht.key' });
    await expect(loadTls(cfg, silentLog)).rejects.toThrow(/Zertifikat nicht lesbar/);
  });
});

describe('HTTP und HTTPS', () => {
  let core: Core;
  let store: Store;
  const close: (() => Promise<unknown>)[] = [];

  afterEach(async () => {
    for (const c of close.splice(0)) await c();
    await core.stop();
    store.close();
  });

  async function setup() {
    const data = await tempDir();
    const cfg = testConfig({ DATA_DIR: data, CACHE_DIR: path.join(data, 'cache'), PHOTOS_DIR: data, HTTPS_ENABLED: 'true' });
    store = new Store(cfg.dataDir);
    core = new Core(cfg, store, silentLog, 'test');
    return cfg;
  }

  it('leitet die Oberfläche auf HTTPS um, Webhook und Healthcheck bleiben auf HTTP', async () => {
    await setup();
    const app = await buildApp(core, silentLog, { redirectToHttpsPort: 8443 });
    close.push(() => app.close());

    const ui = await app.inject({ url: '/ordner?x=1', headers: { host: '192.168.1.5:8080' } });
    expect(ui.statusCode).toBe(308);
    expect(ui.headers.location).toBe('https://192.168.1.5:8443/ordner?x=1');

    const api = await app.inject({ url: '/api/state', headers: { host: 'rahmen.local:8080' } });
    expect(api.headers.location).toBe('https://rahmen.local:8443/api/state');

    expect((await app.inject({ url: '/', headers: { host: 'a b' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/hooks/power-on' })).statusCode).toBe(202);
  });

  it('meldet den WebSocket-Listener beim Schließen ab', async () => {
    await setup();
    const before = core.listenerCount('message');
    const app = await buildApp(core, silentLog);
    expect(core.listenerCount('message')).toBe(before + 1);
    await app.close();
    expect(core.listenerCount('message')).toBe(before);
  });

  it('beantwortet Anfragen über HTTPS mit dem selbstsignierten Zertifikat', async () => {
    const cfg = await setup();
    const tls = await loadTls(cfg, silentLog);
    const app = await buildApp(core, silentLog, { tls });
    close.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const { status, body, fingerprint } = await new Promise<{ status: number; body: string; fingerprint: string }>((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port, path: '/api/health', rejectUnauthorized: false }, (res) => {
          const peer = (res.socket as import('node:tls').TLSSocket).getPeerCertificate();
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, fingerprint: peer.fingerprint256 }));
        })
        .on('error', reject);
    });
    expect(status).toBe(200);
    expect(JSON.parse(body).status).toBe('ok');
    expect(fingerprint).toBe(tls.fingerprint);
  });
});
