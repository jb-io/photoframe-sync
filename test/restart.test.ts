import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Core } from '../src/server/core.js';
import type { SyncState } from '../src/shared/types.js';
import { Store } from '../src/server/db.js';
import { type FlashAirMock, startFlashAirMock } from './flashair-mock.js';
import { silentLog, tempDir, testConfig, writeJpeg } from './helpers.js';
import { type ShellyMock, startShellyMock } from './shelly-mock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung');
    await sleep(50);
  }
}

describe('Neustart nach Sync (RESTART_AFTER_SYNC)', () => {
  let card: FlashAirMock;
  let shelly: ShellyMock;
  let core: Core;
  let store: Store;

  afterEach(async () => {
    await core.stop();
    store.close();
    await card.close();
    await shelly.close();
  });

  async function setup(env: Record<string, string> = {}) {
    card = await startFlashAirMock();
    shelly = await startShellyMock();
    const photos = await tempDir('pfs-restart-');
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 1; i <= 6; i += 1) await writeJpeg(path.join(photos, `${today}_Heute/IMG_${i}.jpg`), 320, 240);
    const data = await tempDir('pfs-restart-data-');
    const cfg = testConfig({
      PHOTOS_DIR: photos,
      DATA_DIR: data,
      CACHE_DIR: path.join(data, 'cache'),
      FLASHAIR_IP: card.ip,
      SHELLY_IP: shelly.ip,
      RESTART_OFF_SEC: '1',
      RESTART_DELAY_SEC: '0',
      POWER_ON_SYNC_DELAY_SEC: '1',
      BOOT_TIMEOUT_SEC: '5',
      TZ: 'UTC',
      ...env,
    });
    store = new Store(cfg.dataDir);
    core = new Core(cfg, store, silentLog, 'test');
    // Wie die Shelly-Action „Switch turned on“ → GET /api/hooks/power-on
    shelly.onTurnedOn = () => core.powerOnHook();
    await core.start();
  }

  /** Wartet, bis nach einem Neustart alles zur Ruhe gekommen ist. */
  async function settle(ms = 4500) {
    await sleep(ms);
    await until(() => core.sync.phase === 'idle' && core.sync.startsAt === null && !core.device.restarting);
  }

  it('startet nach einem Sync mit Änderungen genau einmal neu – keine Schleife über den Webhook', async () => {
    await setup();
    await until(() => shelly.restarts === 1);
    expect(card.files.size).toBe(6);
    await settle();
    // Nach dem Neustart: Webhook → verzögerter Sync ohne Änderungen → kein weiterer Neustart
    expect(shelly.restarts).toBe(1);
    expect(shelly.output).toBe(true);
    expect(core.device.power).toBe(true);
  });

  it('auch ein Sync mit Änderungen direkt nach dem Neustart löst keinen weiteren Neustart aus', async () => {
    await setup();
    // Während des Neustarts verschwindet eine Datei → der Sync danach muss sie neu übertragen.
    shelly.onRestart = () => card.files.delete('IMG_0001.JPG');
    await until(() => shelly.restarts === 1);
    const uploadsBefore = card.uploads.length;
    await settle();
    expect(card.uploads.length).toBe(uploadsBefore + 1);
    expect(shelly.restarts).toBe(1);
  });

  it('meldet einen übersprungenen Neustart, wenn der Sync im Neustart-Fenster etwas ändert', async () => {
    await setup();
    shelly.onRestart = () => card.files.delete('IMG_0001.JPG');
    await until(() => shelly.restarts === 1);
    expect(core.sync.restartSkipped).toBeNull();
    await settle();
    await until(() => core.sync.restartSkipped !== null);
    expect(core.sync.restartSkipped).toContain('gerade erst neu gestartet');
    expect(core.sync.restartPlanned).toBe(false);
  });

  it('zeigt den geplanten Neustart schon während des Syncs an', async () => {
    const seen: SyncState[] = [];
    await setup({ RESTART_DELAY_SEC: '1' });
    core.on('message', (msg) => {
      if (msg.type === 'sync') seen.push(msg.sync);
    });
    await until(() => shelly.restarts === 1);
    expect(seen.some((s) => s.phase === 'uploading' && s.restartPlanned)).toBe(true);
    expect(seen.some((s) => s.phase === 'idle' && s.restartPlanned && s.restartAt !== null)).toBe(true);
    // Nach dem Neustart ist nichts mehr geplant.
    expect(core.sync).toMatchObject({ restartPlanned: false, restartAt: null, restartSkipped: null });
  });

  it('wartet nach dem Sync RESTART_DELAY_SEC, bevor neu gestartet wird', async () => {
    await setup({ RESTART_DELAY_SEC: '2' });
    await until(() => card.files.size === 6 && core.sync.phase === 'idle' && core.sync.lastSuccessAt !== null);
    const syncDone = Date.now();
    expect(shelly.restarts).toBe(0);
    await until(() => shelly.restarts === 1);
    expect(Date.now() - syncDone).toBeGreaterThanOrEqual(1800);
    await settle();
    expect(shelly.restarts).toBe(1);
  });

  it('zeigt während der Wartezeit Neustart geplant mit Zeitpunkt an', async () => {
    await setup({ RESTART_DELAY_SEC: '2' });
    await until(() => core.sync.restartAt !== null);
    expect(core.sync.restartPlanned).toBe(true);
    expect(core.sync.restartAt! - Date.now()).toBeGreaterThan(1000);
    expect(shelly.restarts).toBe(0);
    await until(() => shelly.restarts === 1);
    expect(core.sync).toMatchObject({ restartPlanned: false, restartAt: null });
  });

  it('Ausschalten in der Wartezeit: Neustart entfällt mit Meldung', async () => {
    await setup({ RESTART_DELAY_SEC: '2' });
    await until(() => core.sync.restartAt !== null);
    await core.setPower(false);
    expect(core.sync).toMatchObject({ restartPlanned: false, restartAt: null });
    expect(core.sync.restartSkipped).toContain('Rahmen ist aus');
    await sleep(2500);
    expect(shelly.restarts).toBe(0);
    expect(shelly.output).toBe(false);
  });

  it('Neustart per App in der Wartezeit ersetzt den geplanten Neustart', async () => {
    await setup({ RESTART_DELAY_SEC: '2' });
    await until(() => core.sync.restartAt !== null);
    await core.restartFrame('App');
    expect(core.sync).toMatchObject({ restartPlanned: false, restartAt: null, restartSkipped: null });
    await sleep(2500);
    await settle(0);
    expect(shelly.restarts).toBe(1);
    expect(core.sync.restartSkipped).toBeNull();
  });

  it('startet nicht neu, wenn RESTART_AFTER_SYNC=false', async () => {
    await setup({ RESTART_AFTER_SYNC: 'false' });
    await until(() => card.files.size === 6 && core.sync.phase === 'idle');
    await sleep(1500);
    expect(shelly.restarts).toBe(0);
  });

  it('ohne Neustart nach Sync: kein Hinweis auf geplanten oder übersprungenen Neustart', async () => {
    await setup({ RESTART_AFTER_SYNC: 'false' });
    await until(() => card.files.size === 6 && core.sync.phase === 'idle' && core.sync.lastSuccessAt !== null);
    expect(core.sync).toMatchObject({ restartPlanned: false, restartAt: null, restartSkipped: null });
  });

  it('Neustart per App: aus, nach RESTART_OFF_SEC wieder an, danach verzögerter Sync ohne weiteren Neustart', async () => {
    await setup({ RESTART_AFTER_SYNC: 'false' });
    await until(() => card.files.size === 6 && core.sync.phase === 'idle' && core.device.power === true);
    await core.restartFrame('App');
    expect(core.device).toMatchObject({ power: false, restarting: true, booting: true });
    await until(() => core.device.power === true && !core.device.restarting);
    await settle(2500);
    expect(shelly.restarts).toBe(1);
  });
});
