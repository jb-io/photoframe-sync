import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Server as HttpsServer } from 'node:https';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { Core } from './core.js';
import { Store } from './db.js';
import { createLogger } from './log.js';
import { loadTls, TlsError, watchCertFiles } from './tls.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const log = createLogger(cfg.logLevel);
  const version = readVersion();
  const store = new Store(cfg.dataDir);
  const core = new Core(cfg, store, log, version);

  const webDir = path.join(root, 'dist/web');
  const apps: FastifyInstance[] = [];
  let stopWatching = () => {};

  // HTTPS optional: eigenes Zertifikat oder selbstsigniert (/data/tls).
  if (cfg.https.enabled) {
    let tls;
    try {
      tls = await loadTls(cfg, log);
    } catch (err) {
      if (err instanceof TlsError) {
        log.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    const httpsApp = await buildApp(core, log, { webDir, tls });
    apps.push(httpsApp);
    stopWatching = watchCertFiles(cfg, log, (next) => {
      (httpsApp.server as unknown as HttpsServer).setSecureContext({ key: next.key, cert: next.cert });
    });
    log.info({ source: tls.source, validTo: tls.validTo, names: tls.names, fingerprint: tls.fingerprint }, 'HTTPS aktiv');
  }
  const httpApp = await buildApp(core, log, {
    webDir,
    redirectToHttpsPort: cfg.https.enabled && cfg.https.redirect ? cfg.https.publicPort : undefined,
  });
  apps.unshift(httpApp);

  // Erst die Ports belegen, dann Scan/Sync starten: Ist ein Port belegt, endet
  // der Prozess sauber, bevor irgendetwas auf die Karte schreibt.
  try {
    await httpApp.listen({ port: cfg.port, host: '0.0.0.0' });
    if (apps[1]) await apps[1].listen({ port: cfg.https.port, host: '0.0.0.0' });
  } catch (err) {
    log.error({ err }, `Port nicht verfügbar: ${(err as Error).message}`);
    stopWatching();
    await Promise.all(apps.map((a) => a.close().catch(() => {})));
    store.close();
    process.exit(1);
  }
  await core.start();
  log.info(
    {
      version,
      port: cfg.port,
      httpsPort: cfg.https.enabled ? cfg.https.port : null,
      photos: cfg.photosDir,
      card: cfg.flashair.ip ?? null,
      shelly: cfg.shelly.ip ?? null,
    },
    'Bilderrahmen Sync gestartet',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Fahre herunter …');
    stopWatching();
    await core.stop();
    await Promise.all(apps.map((a) => a.close()));
    store.close();
    log.info('Beendet');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

await main();
