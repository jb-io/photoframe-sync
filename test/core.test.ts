import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Core } from '../src/server/core.js';
import { Store } from '../src/server/db.js';
import { type FlashAirMock, startFlashAirMock } from './flashair-mock.js';
import { silentLog, tempDir, testConfig, writeJpeg } from './helpers.js';

async function until(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Core mit FlashAir-Mock', () => {
  let mock: FlashAirMock;
  let core: Core;
  let store: Store;

  afterEach(async () => {
    await core.stop();
    store.close();
    await mock.close();
  });

  async function setup(env: Record<string, string> = {}) {
    mock = await startFlashAirMock();
    const photos = await tempDir('pfs-core-');
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 1; i <= 12; i += 1) await writeJpeg(path.join(photos, `${today}_Heute/IMG_${String(i).padStart(2, '0')}.jpg`), 320, 240);
    const data = await tempDir('pfs-core-data-');
    const cfg = testConfig({
      PHOTOS_DIR: photos,
      DATA_DIR: data,
      CACHE_DIR: path.join(data, 'cache'),
      FLASHAIR_IP: mock.ip,
      REACHABILITY_INTERVAL_SEC: '5',
      TZ: 'UTC',
      ...env,
    });
    store = new Store(cfg.dataDir);
    core = new Core(cfg, store, silentLog, 'test');
    await core.start();
    await until(() => core.sync.phase === 'idle' && !core.sync.pending && mock.files.size === 12);
  }

  const cardNames = () => new Map(store.cardFiles().map((f) => [f.rel, f.name]));

  it('überträgt beim Start und vergibt zufällige Nummern (NAMING_ORDER=random)', async () => {
    await setup();
    const names = [...cardNames().entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, n]) => n);
    expect([...names].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `IMG_${String(i + 1).padStart(4, '0')}.JPG`));
    expect(names).not.toEqual([...names].sort());
  });

  it('„neu mischen“ übersteht eine Neuberechnung vor dem Upload', async () => {
    await setup();
    const before = cardNames();
    core.shuffle();
    // Ein Scan direkt danach berechnet den Plan erneut – die neuen Namen müssen bleiben.
    await core.runScan();
    await until(() => core.sync.phase === 'idle' && !core.sync.pending);
    const after = cardNames();
    const changed = [...after].filter(([rel, name]) => before.get(rel) !== name).length;
    expect(changed).toBeGreaterThan(6);
    expect(core.sync.pending).toBe(false);
  });

  it('mischt neu, wenn sich das Namensschema ändert', async () => {
    await setup({ NAMING_ORDER: 'original' });
    const sequential = [...cardNames().entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, n]) => n);
    expect(sequential).toEqual([...sequential].sort());
    await core.stop();
    store.close();

    // Neustart mit NAMING_ORDER=random und demselben Datenordner
    const cfg = { ...core.cfg, namingOrder: 'random' as const };
    store = new Store(cfg.dataDir);
    core = new Core(cfg, store, silentLog, 'test');
    await core.start();
    // Bilder, die zufällig ihre alte Nummer behalten, werden nicht erneut übertragen.
    await until(() => core.sync.phase === 'idle' && !core.sync.pending && mock.uploads.length > 12);
    const names = [...cardNames().entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, n]) => n);
    expect(names).not.toEqual([...names].sort());
  });
});
