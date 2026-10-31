import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Selection } from '../src/shared/types.js';
import { DEFAULT_SELECTION } from '../src/shared/types.js';
import { Store } from '../src/server/db.js';
import { FlashAir, parseFileList } from '../src/server/device/flashair.js';
import { FrameCache } from '../src/server/frame/cache.js';
import { scanPhotos } from '../src/server/folders/scanner.js';
import { assignCardNames, plannedImages, selectedFolders } from '../src/server/sync/plan.js';
import { CardFullError, diffCard, runSync } from '../src/server/sync/runner.js';
import { type FlashAirMock, startFlashAirMock } from './flashair-mock.js';
import { silentLog, tempDir, testConfig, writeJpeg } from './helpers.js';

describe('parseFileList', () => {
  it('liest Dateien, ignoriert Ordner und markiert geschützte Dateien', () => {
    const files = parseFileList('WLANSD_FILELIST\r\n,IMG_0001.JPG,1000,32,1,2\r\n,DCIM,0,16,1,2\r\n,Mit,Komma.JPG,5,32,1,2\r\n,SYS.BIN,9,6,1,2\r\n,.hidden,1,32,1,2');
    expect(files.map((f) => [f.name, f.protected])).toEqual([
      ['IMG_0001.JPG', false],
      ['Mit,Komma.JPG', false],
      ['SYS.BIN', true],
      ['.hidden', true],
    ]);
  });
});

describe('diffCard', () => {
  const img = (cardName: string, frameKey = 'k') => ({ folderId: 'f', rel: cardName, mtimeMs: 0, frameKey, cardName });
  it('lädt Fehlendes und Geändertes hoch, löscht Überzähliges, schützt Systemdateien', () => {
    const diff = diffCard(
      [img('IMG_0001.JPG'), img('IMG_0002.JPG', 'neu'), img('IMG_0003.JPG')],
      [
        { name: 'IMG_0001.JPG', size: 10, attributes: 32, protected: false },
        { name: 'IMG_0002.JPG', size: 10, attributes: 32, protected: false },
        { name: 'ALT.JPG', size: 10, attributes: 32, protected: false },
        { name: 'SYSTEM.DAT', size: 10, attributes: 4, protected: true },
      ],
      [
        { name: 'IMG_0001.JPG', rel: 'x', folderId: 'f', frameKey: 'k', size: 10, uploadedAt: 0 },
        { name: 'IMG_0002.JPG', rel: 'y', folderId: 'f', frameKey: 'alt', size: 10, uploadedAt: 0 },
      ],
      true,
    );
    expect(diff.upload.map((u) => u.cardName)).toEqual(['IMG_0002.JPG', 'IMG_0003.JPG']);
    expect([...diff.replace]).toEqual(['IMG_0002.JPG']);
    expect(diff.remove.map((r) => r.name)).toEqual(['ALT.JPG']);
  });

  it('löscht nichts, wenn SYNC_DELETE_EXTRA aus ist', () => {
    expect(diffCard([], [{ name: 'A.JPG', size: 1, attributes: 32, protected: false }], [], false).remove).toEqual([]);
  });
});

describe('Sync gegen FlashAir-Mock', () => {
  let mock: FlashAirMock;
  let store: Store;
  let cache: FrameCache;
  let card: FlashAir;
  let photos: string;
  let cfg: ReturnType<typeof testConfig>;

  beforeEach(async () => {
    mock = await startFlashAirMock();
    photos = await tempDir('pfs-photos-');
    for (let i = 1; i <= 4; i += 1) await writeJpeg(path.join(photos, `2026/2026-10-0${i}_Tag_${i}/IMG_1.jpg`), 640, 480);
    await writeJpeg(path.join(photos, '2026/2026-10-01_Tag_1/IMG_2.jpg'), 480, 640);
    const data = await tempDir('pfs-data-');
    cfg = testConfig({ PHOTOS_DIR: photos, DATA_DIR: data, CACHE_DIR: path.join(data, 'cache'), FLASHAIR_IP: mock.ip });
    store = new Store(cfg.dataDir);
    cache = new FrameCache(cfg, silentLog);
    await cache.init();
    card = new FlashAir({ ip: mock.ip, dir: '/' });
    const scan = await scanPhotos(photos, silentLog);
    store.replaceScan(scan.folders, scan.images);
  });

  afterEach(async () => {
    store.close();
    await mock.close();
  });

  const plan = (selection: Partial<Selection> = {}) => {
    const s = { ...DEFAULT_SELECTION, mode: 'auto' as const, windowMonths: 12, ...selection };
    const folders = selectedFolders(s, store.folders(), '2026-10-31');
    const planned = plannedImages(folders, (id) => store.images(id), s, '2026-10-31', cfg.frameConfigHash);
    const previous = new Map(store.cardFiles().map((t) => [t.rel, t.name]));
    return assignCardNames(planned, { naming: 'dcim', order: 'original', previous, shuffleSeed: 's' });
  };
  const deps = (extra: Partial<Parameters<typeof runSync>[1]> = {}) => ({
    card,
    cache,
    store,
    log: silentLog,
    deleteExtra: true,
    onProgress: () => {},
    shouldAbort: () => false,
    ...extra,
  });

  it('überträgt alles, danach nur noch Änderungen (FA-30)', async () => {
    mock.files.set('DCIM', { data: Buffer.alloc(0), attr: 16 });
    mock.files.set('FREMD.JPG', { data: Buffer.alloc(10), attr: 32 });
    mock.files.set('SCHUTZ.JPG', { data: Buffer.alloc(10), attr: 1 });

    const first = await runSync(plan(), deps());
    expect(first).toMatchObject({ uploaded: 5, deleted: 1, failed: 0 });
    expect([...mock.files.keys()].sort()).toEqual(['DCIM', 'IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG', 'SCHUTZ.JPG']);

    mock.uploads.length = 0;
    const second = await runSync(plan(), deps());
    expect(second).toMatchObject({ uploaded: 0, deleted: 0 });
    expect(mock.uploads).toEqual([]);
  });

  it('entfernt abgewählte Ordner (Spiegelbetrieb, FA-29)', async () => {
    await runSync(plan(), deps());
    const keep = store.folders().filter((f) => f.title !== 'Tag 4').map((f) => f.id);
    const result = await runSync(plan({ mode: 'manual', manual: keep }), deps());
    expect(result.deleted).toBe(1);
    expect(mock.files.has('IMG_0005.JPG')).toBe(false);
  });

  it('setzt nach einem Abbruch fort (FA-30)', async () => {
    mock.failAfterUploads = 2;
    await expect(runSync(plan(), deps())).rejects.toThrow();
    expect(store.cardFiles()).toHaveLength(2);
    mock.failAfterUploads = null;
    mock.uploads.length = 0;
    const result = await runSync(plan(), deps());
    expect(result.uploaded).toBe(3);
    expect(mock.uploads).toEqual(['IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0005.JPG']);
  });

  it('bricht bei vollem Speicher sauber ab (FA-24)', async () => {
    mock.capacityBytes = 2 * 1024 * 1024 + 30_000;
    await expect(runSync(plan(), deps())).rejects.toBeInstanceOf(CardFullError);
    expect(store.cardFiles().length).toBeGreaterThan(0);
    expect(store.cardFiles().length).toBeLessThan(5);
  });

  it('hört zwischen zwei Dateien auf, wenn abgebrochen wird', async () => {
    let calls = 0;
    await expect(runSync(plan(), deps({ shouldAbort: () => ++calls > 2 }))).rejects.toThrow(/abgebrochen/);
    expect(mock.uploads).toHaveLength(2);
  });
});
