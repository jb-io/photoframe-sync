import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/server/config.js';

describe('loadConfig', () => {
  it('setzt Defaults laut Anforderungen', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8080);
    expect(cfg.frame).toMatchObject({ width: 800, height: 600, fitMode: 'crop', cropGravity: 'attention', jpegQuality: 88 });
    expect(cfg.flashair).toMatchObject({ dir: '/', deleteExtra: true, reachabilityIntervalSec: 60 });
    expect(cfg.powerOnSyncDelaySec).toBe(30);
    expect(cfg.naming).toBe('dcim');
    expect(cfg.namingOrder).toBe('random');
    expect(cfg).toMatchObject({ restartAfterSync: true, restartOffSec: 5, restartDelaySec: 10 });
  });

  it('behandelt leere Variablen wie nicht gesetzt', () => {
    expect(loadConfig({ FLASHAIR_IP: '', SHELLY_IP: '' }).flashair.ip).toBeUndefined();
  });

  it('meldet ungültige Werte verständlich', () => {
    expect(() => loadConfig({ FIT_MODE: 'stretch' })).toThrow(ConfigError);
    expect(() => loadConfig({ SYNC_DELETE_EXTRA: 'vielleicht' })).toThrow(/SYNC_DELETE_EXTRA/);
    expect(() => loadConfig({ TZ: 'Mars/Olympus' })).toThrow(/TZ/);
  });

  it('ändert den Konfigurations-Hash nur bei bildrelevanten Werten', () => {
    const base = loadConfig({}).frameConfigHash;
    expect(loadConfig({ PORT: '9000' }).frameConfigHash).toBe(base);
    expect(loadConfig({ TARGET_WIDTH: '1024' }).frameConfigHash).not.toBe(base);
  });
});
