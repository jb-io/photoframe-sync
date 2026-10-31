import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Core } from '../src/server/core.js';
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

  it('startet nicht neu, wenn RESTART_AFTER_SYNC=false', async () => {
    await setup({ RESTART_AFTER_SYNC: 'false' });
    await until(() => card.files.size === 6 && core.sync.phase === 'idle');
    await sleep(1500);
    expect(shelly.restarts).toBe(0);
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
