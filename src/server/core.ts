import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  DeviceState,
  Folder,
  FrameFolderState,
  PlanSummary,
  ScanState,
  Selection,
  ServerMessage,
  Snapshot,
  SyncState,
} from '../shared/types.js';
import type { Config } from './config.js';
import type { Store } from './db.js';
import { FlashAir } from './device/flashair.js';
import { Shelly } from './device/shelly.js';
import { FrameCache } from './frame/cache.js';
import { ScanError, scanPhotos } from './folders/scanner.js';
import type { Logger } from './log.js';
import { assignCardNames, type NamedImage, plannedImages, selectedFolders } from './sync/plan.js';
import { CardFullError, runSync, SyncAbortedError } from './sync/runner.js';
import { msUntilNextDay, todayIn } from './time.js';

/** Schätzwert für noch nicht aufbereitete Rahmenbilder bei 800 × 600 */
const ESTIMATED_FRAME_BYTES = 150 * 1024;
const BOOT_POLL_MS = 5000;

export class Core extends EventEmitter<{ message: [ServerMessage] }> {
  readonly cache: FrameCache;
  private card?: FlashAir;
  private shelly?: Shelly;

  private folders: Folder[];
  private today: string;
  private named: NamedImage[] = [];
  private planSignature = '';
  private lastAutoSyncSignature = '';
  private frameSizes = new Map<string, number>();

  scan: ScanState = { running: false, lastScanAt: null, error: null };
  device: DeviceState;
  sync: SyncState;
  plan: PlanSummary = { folders: 0, images: 0, imagesTotal: 0, estimatedBytes: 0, availableBytes: null };
  frame: Record<string, FrameFolderState> = {};

  private timers = new Set<NodeJS.Timeout>();
  private pollTimer?: NodeJS.Timeout;
  private delayedSyncTimer?: NodeJS.Timeout;
  private bootUntil = 0;
  /** Bis wann der Shelly beim Neustart aus ist (plus Puffer) */
  private restartOffUntil = 0;
  /**
   * Schutzfenster nach einem Neustart: Ein Sync, der davor startet, löst keinen
   * weiteren Neustart aus. Verhindert die Schleife Neustart → Webhook → Sync → Neustart.
   */
  private restartGuardUntil = 0;
  /** Ein Sync mit Änderungen ist gelaufen; Neustart, sobald keine Folgeläufe mehr anstehen */
  private restartWanted = false;
  /** Wartezeit vor dem Neustart nach Sync (RESTART_DELAY_SEC) */
  private restartDelayTimer?: NodeJS.Timeout;
  /** Beendet die Wartezeit vorzeitig; `false` = Neustart entfällt */
  private restartDelayDone?: (proceed: boolean) => void;
  private syncRun?: Promise<void>;
  private syncAgain = false;
  private abortSync = false;
  private prepareGeneration = 0;
  private stopped = false;

  constructor(
    readonly cfg: Config,
    readonly store: Store,
    readonly log: Logger,
    readonly version: string,
  ) {
    super();
    this.cache = new FrameCache(cfg, log.child({ mod: 'cache' }));
    if (cfg.flashair.ip) this.card = new FlashAir({ ...cfg.flashair, ip: cfg.flashair.ip });
    if (cfg.shelly.ip) this.shelly = new Shelly({ ...cfg.shelly, ip: cfg.shelly.ip });
    this.folders = store.folders();
    this.today = todayIn(cfg.timeZone);
    this.scan.lastScanAt = store.get<number | null>('lastScanAt', null);
    this.device = {
      cardConfigured: Boolean(this.card),
      cardOnline: false,
      cardFreeBytes: store.get<number | null>('cardFreeBytes', null),
      cardTotalBytes: store.get<number | null>('cardTotalBytes', null),
      powerConfigured: Boolean(this.shelly),
      power: null,
      booting: false,
      restarting: false,
    };
    this.sync = {
      phase: 'idle',
      pending: false,
      done: 0,
      total: 0,
      lastSuccessAt: store.get<number | null>('lastSyncAt', null),
      lastError: null,
      startsAt: null,
      restartPlanned: false,
      restartAt: null,
      restartSkipped: null,
    };
  }

  // --- Lebenszyklus -----------------------------------------------------

  async start(): Promise<void> {
    await this.cache.init();
    this.frameSizes = await this.cache.frameSizes();
    this.recomputePlan('start');
    if (!this.card) this.log.warn('FLASHAIR_IP ist nicht gesetzt – Sync ist deaktiviert');
    if (!this.shelly) this.log.info('SHELLY_IP ist nicht gesetzt – Ein/Aus ist ausgeblendet');
    else if (this.cfg.restartAfterSync) this.log.info({ offSec: this.cfg.restartOffSec }, 'Rahmen wird nach einem Sync mit Änderungen neu gestartet');

    void this.runScan();
    this.every(this.cfg.scanIntervalSec * 1000, () => void this.runScan());
    this.scheduleMidnight();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortSync = true;
    for (const t of this.timers) clearTimeout(t);
    this.cancelRestartDelay();
    clearTimeout(this.pollTimer);
    clearTimeout(this.delayedSyncTimer);
    this.prepareGeneration += 1;
    if (this.syncRun) {
      this.log.info('Warte auf laufenden Upload …');
      await Promise.race([this.syncRun, new Promise((r) => setTimeout(r, 30_000))]);
    }
  }

  private every(ms: number, fn: () => void): void {
    const t = setInterval(fn, ms);
    t.unref();
    this.timers.add(t);
  }

  private emitMessage(message: ServerMessage): void {
    this.emit('message', message);
  }

  snapshot(): Snapshot {
    return {
      version: this.version,
      today: this.today,
      folders: this.folders,
      scan: this.scan,
      selection: this.store.selection(),
      frame: this.frame,
      device: this.device,
      sync: this.sync,
      plan: this.plan,
      naming: { mode: this.cfg.naming, order: this.cfg.namingOrder },
    };
  }

  folderById(id: string): Folder | undefined {
    return this.folders.find((f) => f.id === id);
  }

  // --- Ordner-Scan ------------------------------------------------------

  async runScan(): Promise<void> {
    if (this.scan.running) return;
    this.scan = { ...this.scan, running: true };
    this.emitMessage({ type: 'scan', scan: this.scan });
    const started = Date.now();
    try {
      const result = await scanPhotos(this.cfg.photosDir, this.log.child({ mod: 'scan' }));
      // Ein leeres Verzeichnis nach einem gefüllten heißt fast immer: Netzlaufwerk
      // nicht eingehängt. Dann den letzten Stand behalten (NFA-03).
      if (result.folders.length === 0 && this.folders.length > 0) {
        throw new ScanError('Bilderverzeichnis ist leer – ist das Netzlaufwerk eingehängt? Letzter Scan bleibt aktiv.');
      }
      this.store.replaceScan(result.folders, result.images);
      this.folders = this.store.folders();
      this.scan = { running: false, lastScanAt: Date.now(), error: null };
      this.store.set('lastScanAt', this.scan.lastScanAt);
      this.log.info({ folders: result.folders.length, images: result.images.length, ms: Date.now() - started }, 'Scan fertig');
      this.emitMessage({ type: 'folders', folders: this.folders, scan: this.scan });
      this.recomputePlan('scan');
    } catch (err) {
      const message = err instanceof ScanError ? err.message : `Scan fehlgeschlagen: ${(err as Error).message}`;
      this.log.error({ err }, message);
      this.scan = { ...this.scan, running: false, error: message };
      this.emitMessage({ type: 'scan', scan: this.scan });
    }
  }

  // --- Auswahl und Plan -------------------------------------------------

  saveSelection(selection: Selection): void {
    this.store.set('selection', selection);
    this.recomputePlan('selection');
    this.emitMessage({ type: 'selection', selection, plan: this.plan });
    if (this.device.cardOnline) this.requestSync('gespeichert');
  }

  /** Neue Zufallsreihenfolge für NAMING_ORDER=random (FA-31). */
  shuffle(): void {
    this.store.set('shuffleSeed', randomUUID());
    this.store.set('shuffleReset', true);
    this.recomputePlan('shuffle');
    if (this.device.cardOnline) this.requestSync('neu gemischt');
  }

  /**
   * Soll-Liste neu berechnen, Kartennamen vergeben, Ordnerstatus und
   * Platzschätzung aktualisieren. Danach ggf. Aufbereitung und Sync anstoßen.
   */
  private recomputePlan(reason: string): void {
    const selection = this.store.selection();
    const folders = selectedFolders(selection, this.folders, this.today);
    const planned = plannedImages(folders, (id) => this.store.images(id), selection, this.today, this.cfg.frameConfigHash);

    const tracked = this.store.cardFiles();
    // Nach „neu mischen“ oder einem geänderten Namensschema (NAMING/NAMING_ORDER)
    // werden alle Namen neu vergeben, sonst bleiben vorhandene Nummern stabil.
    const scheme = `${this.cfg.naming}/${this.cfg.namingOrder}`;
    const reset = this.store.get('shuffleReset', false) || this.store.get<string | null>('namingScheme', null) !== scheme;
    // Die Zuordnung Quellbild → Kartenname wird gespeichert, nicht aus card_files
    // abgeleitet: Sonst ginge ein Neumischen bei der nächsten Neuberechnung
    // verloren, solange noch nichts hochgeladen ist.
    const stored = this.store.get<Record<string, string> | null>('cardNames', null);
    const previous = new Map<string, string>(
      reset ? [] : stored ? Object.entries(stored) : tracked.map((t) => [t.rel, t.name] as const),
    );
    let shuffleSeed = this.store.get<string | null>('shuffleSeed', null);
    if (!shuffleSeed) {
      shuffleSeed = randomUUID();
      this.store.set('shuffleSeed', shuffleSeed);
    }
    this.named = assignCardNames(planned, {
      naming: this.cfg.naming,
      order: this.cfg.namingOrder,
      previous,
      shuffleSeed,
    });
    this.store.set('cardNames', Object.fromEntries(this.named.map((n) => [n.rel, n.cardName])));
    if (reset) {
      this.store.set('shuffleReset', false);
      this.store.set('namingScheme', scheme);
    }

    this.frame = this.computeFrameState(tracked);
    const imagesTotal = folders.reduce((sum, f) => sum + f.imageCount, 0);
    this.plan = {
      folders: folders.length,
      images: this.named.length,
      imagesTotal,
      estimatedBytes: this.estimateBytes(),
      availableBytes: this.availableBytes(),
    };

    const trackedKey = new Map(tracked.map((t) => [t.name, t.frameKey]));
    const plannedNames = new Set(this.named.map((n) => n.cardName));
    const outOfDate =
      this.named.some((n) => trackedKey.get(n.cardName) !== n.frameKey) || tracked.some((t) => !plannedNames.has(t.name));
    this.planSignature = createHash('sha1')
      .update(this.named.map((n) => `${n.cardName}=${n.frameKey}`).join('|'))
      .digest('hex');
    this.setSync({ pending: outOfDate });

    this.emitMessage({ type: 'frame', frame: this.frame });
    this.emitMessage({ type: 'plan', plan: this.plan, today: this.today });
    this.log.debug({ reason, folders: folders.length, images: this.named.length, outOfDate }, 'Plan berechnet');

    if (reason !== 'after-sync') {
      void this.prepareFrames();
      // Neue Ordner (Automatik), Tageswechsel o. Ä.: sofort übertragen, wenn online.
      if (outOfDate && this.device.cardOnline && reason !== 'selection' && reason !== 'start') {
        this.maybeAutoSync(reason);
      }
    }
  }

  private maybeAutoSync(reason: string): void {
    if (this.planSignature === this.lastAutoSyncSignature) return;
    this.requestSync(reason);
  }

  private computeFrameState(tracked: ReturnType<Store['cardFiles']>): Record<string, FrameFolderState> {
    const byName = new Map(tracked.map((t) => [t.name, t]));
    const state: Record<string, FrameFolderState> = {};
    for (const t of tracked) state[t.folderId] = { onCard: true, complete: false };
    const incomplete = new Set<string>();
    for (const n of this.named) {
      const t = byName.get(n.cardName);
      if (!t || t.frameKey !== n.frameKey) incomplete.add(n.folderId);
    }
    for (const n of this.named) {
      const entry = state[n.folderId];
      if (entry) entry.complete = !incomplete.has(n.folderId);
    }
    return state;
  }

  private estimateBytes(): number {
    const known = [...this.frameSizes.values()];
    const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : ESTIMATED_FRAME_BYTES;
    return Math.round(this.named.reduce((sum, n) => sum + (this.frameSizes.get(n.frameKey) ?? average), 0));
  }

  private availableBytes(): number | null {
    if (this.device.cardFreeBytes === null) return null;
    return this.device.cardFreeBytes + this.store.get<number>('cardReclaimableBytes', 0);
  }

  /** Fehlende Rahmenbilder im Hintergrund aufbereiten, nicht mehr benötigte löschen. */
  private async prepareFrames(): Promise<void> {
    const generation = ++this.prepareGeneration;
    // Kurz warten, damit mehrere Änderungen in Folge nur einen Lauf ergeben.
    await new Promise((r) => setTimeout(r, 1000));
    if (generation !== this.prepareGeneration) return;
    const named = this.named;
    let created = 0;
    for (const img of named) {
      if (generation !== this.prepareGeneration || this.stopped) return;
      if (this.frameSizes.has(img.frameKey)) continue;
      try {
        await this.cache.ensureFrame(img.rel, img.frameKey);
        const size = await this.cache.frameSize(img.frameKey);
        if (size !== null) this.frameSizes.set(img.frameKey, size);
        created += 1;
      } catch (err) {
        this.log.warn({ err, rel: img.rel }, 'Rahmenbild konnte nicht erzeugt werden');
      }
    }
    if (generation !== this.prepareGeneration) return;
    const keep = new Set(named.map((n) => n.frameKey));
    await this.cache.cleanupFrames(keep);
    for (const key of [...this.frameSizes.keys()]) if (!keep.has(key)) this.frameSizes.delete(key);
    if (created) {
      this.log.info({ created }, 'Rahmenbilder aufbereitet');
      this.plan = { ...this.plan, estimatedBytes: this.estimateBytes() };
      this.emitMessage({ type: 'plan', plan: this.plan, today: this.today });
    }
  }

  private scheduleMidnight(): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      const today = todayIn(this.cfg.timeZone);
      if (today !== this.today) {
        this.log.info({ today }, 'Tageswechsel – Auswahl wird neu berechnet');
        this.today = today;
        this.recomputePlan('day');
      }
      this.scheduleMidnight();
    }, msUntilNextDay(this.cfg.timeZone));
    t.unref();
    this.timers.add(t);
  }

  // --- Gerät: Erreichbarkeit und Strom ----------------------------------

  private setDevice(patch: Partial<DeviceState>): void {
    const next = { ...this.device, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.device)) return;
    this.device = next;
    this.emitMessage({ type: 'device', device: this.device });
  }

  private setSync(patch: Partial<SyncState>): void {
    const next = { ...this.sync, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.sync)) return;
    this.sync = next;
    this.emitMessage({ type: 'sync', sync: this.sync });
  }

  /** Erreichbarkeitsprüfung für Shelly und Karte (Rückfall zum Webhook). */
  private async poll(): Promise<void> {
    clearTimeout(this.pollTimer);
    if (this.stopped) return;
    try {
      await this.checkDevices();
    } catch (err) {
      this.log.error({ err }, 'Gerätestatus konnte nicht geprüft werden');
    }
    if (this.stopped) return;
    const interval = this.device.booting ? BOOT_POLL_MS : this.cfg.flashair.reachabilityIntervalSec * 1000;
    this.pollTimer = setTimeout(() => void this.poll(), interval);
    this.pollTimer.unref();
  }

  private async checkDevices(): Promise<void> {
    let power = this.device.power;
    if (this.shelly) {
      try {
        power = await this.shelly.getPower();
      } catch (err) {
        this.log.debug({ err }, 'Shelly nicht erreichbar');
        power = null;
      }
      // Neustart läuft: Der Shelly ist absichtlich aus und schaltet sich selbst wieder ein.
      if (power === false && Date.now() < this.restartOffUntil) {
        this.setDevice({ power: false, cardOnline: false, booting: true, restarting: true });
        return;
      }
      // Taste am Plug gedrückt (aus → an): wie ein Einschalten aus der App.
      if (power === true && this.device.power === false) {
        this.onPoweredOn(Date.now() < this.restartGuardUntil ? 'Neustart' : 'Taste am Plug');
      }
      if (power === false && this.device.power !== false) this.onPoweredOff();
      this.setDevice({ power });
    }

    if (!this.card) return;
    // Ausgeschaltet heißt offline (FA-36) – die Karte wird dann gar nicht gefragt.
    if (power === false) {
      this.setDevice({ cardOnline: false, booting: false });
      return;
    }
    // Während eines Syncs zeigt der Lauf selbst, ob die Karte noch da ist.
    if (this.syncRun) return;

    const online = await this.card.isReachable();
    const wasOnline = this.device.cardOnline;
    const booting = this.device.booting && !online && Date.now() < this.bootUntil;
    this.setDevice({ cardOnline: online, booting });
    if (online && !wasOnline) await this.onCardOnline();
  }

  private async onCardOnline(): Promise<void> {
    this.log.info('Karte ist erreichbar');
    await this.refreshSpace();
    // Ein verzögerter Sync (nach dem Einschalten) läuft gleich ohnehin.
    if (this.delayedSyncTimer) return;
    if (this.sync.pending) this.requestSync('Karte erreichbar');
  }

  private async refreshSpace(): Promise<void> {
    if (!this.card) return;
    try {
      const space = await this.card.space();
      this.store.set('cardFreeBytes', space.freeBytes);
      this.store.set('cardTotalBytes', space.totalBytes);
      this.setDevice({ cardFreeBytes: space.freeBytes, cardTotalBytes: space.totalBytes });
      this.plan = { ...this.plan, availableBytes: this.availableBytes() };
      this.emitMessage({ type: 'plan', plan: this.plan, today: this.today });
    } catch (err) {
      this.log.debug({ err }, 'Freier Speicher nicht lesbar');
    }
  }

  private onPoweredOn(source: string): void {
    this.log.info({ source }, 'Rahmen eingeschaltet');
    this.bootUntil = Date.now() + this.cfg.bootTimeoutSec * 1000;
    this.setDevice({ power: this.shelly ? true : this.device.power, booting: !this.device.cardOnline, restarting: false });
    this.scheduleDelayedSync(source);
    // Schneller prüfen, solange der Rahmen startet.
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), BOOT_POLL_MS);
    this.pollTimer.unref();
  }

  private onPoweredOff(): void {
    this.log.info('Rahmen ausgeschaltet');
    clearTimeout(this.delayedSyncTimer);
    this.delayedSyncTimer = undefined;
    this.abortSync = Boolean(this.syncRun);
    if (this.restartDelayDone) {
      this.cancelRestartDelay();
      this.skipRestart('Neustart nach Sync entfällt – der Rahmen ist aus.');
    }
    this.setDevice({ power: this.shelly ? false : this.device.power, cardOnline: false, booting: false, restarting: false });
    this.setSync({ startsAt: null, phase: this.syncRun ? this.sync.phase : 'idle' });
  }

  /**
   * Rahmen aus- und nach RESTART_OFF_SEC wieder einschalten. Das Wiedereinschalten
   * erledigt der Shelly selbst; danach läuft der übliche Ablauf (Webhook bzw.
   * Polling → „startet …“ → verzögerter Sync).
   */
  async restartFrame(source: string): Promise<void> {
    if (!this.shelly) throw new Error('SHELLY_IP ist nicht gesetzt');
    if (this.device.power !== true) throw new Error('Rahmen ist ausgeschaltet');
    const offMs = this.cfg.restartOffSec * 1000;
    await this.shelly.restart(this.cfg.restartOffSec);
    const now = Date.now();
    this.restartOffUntil = now + offMs + 2000;
    this.restartGuardUntil = now + offMs + (this.cfg.bootTimeoutSec + this.cfg.powerOnSyncDelaySec + 60) * 1000;
    this.bootUntil = now + offMs + this.cfg.bootTimeoutSec * 1000;
    this.log.info({ source, offSec: this.cfg.restartOffSec }, 'Rahmen wird neu gestartet');
    // Ein geplanter Neustart nach Sync ist damit erledigt.
    this.restartWanted = false;
    this.cancelRestartDelay();

    clearTimeout(this.delayedSyncTimer);
    this.delayedSyncTimer = undefined;
    this.abortSync = Boolean(this.syncRun);
    this.setDevice({ power: false, cardOnline: false, booting: true, restarting: true });
    this.setSync({ startsAt: null, phase: this.syncRun ? this.sync.phase : 'idle', restartPlanned: false, restartAt: null, restartSkipped: null });

    // Kurz nach dem Wiedereinschalten prüfen – falls kein Webhook kommt.
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), offMs + 1000);
    this.pollTimer.unref();
  }

  /** Neustart nach dem Sync (RESTART_AFTER_SYNC), mit Schutz gegen Schleifen. */
  private async restartAfterSync(): Promise<void> {
    if (!this.shelly || !this.cfg.restartAfterSync || this.stopped) return;
    if (this.device.power !== true) {
      this.skipRestart('Neustart nach Sync entfällt – der Rahmen ist aus.');
      return;
    }

    // Erst warten, bis die Karte ihre Schreibvorgänge abgeschlossen hat – ein
    // Stromausfall mitten im Schreiben kann das FAT-Dateisystem beschädigen.
    if (this.cfg.restartDelaySec > 0) {
      this.log.info({ delaySec: this.cfg.restartDelaySec }, 'Neustart nach Sync in Kürze – Karte schreibt fertig');
      this.cancelRestartDelay();
      this.setSync({ restartPlanned: true, restartAt: Date.now() + this.cfg.restartDelaySec * 1000 });
      const proceed = await new Promise<boolean>((resolve) => {
        this.restartDelayDone = resolve;
        this.restartDelayTimer = setTimeout(() => resolve(true), this.cfg.restartDelaySec * 1000);
        this.restartDelayTimer.unref();
      });
      this.restartDelayTimer = undefined;
      this.restartDelayDone = undefined;
      this.setSync({ restartAt: null });
      // Abgebrochen: inzwischen von Hand neu gestartet oder App wird beendet.
      if (!proceed || this.stopped) return;
      if (this.device.power !== true) {
        this.skipRestart('Neustart nach Sync entfällt – der Rahmen ist aus.');
        return;
      }
      // Läuft inzwischen ein neuer Sync, kommt der Neustart erst nach dessen Ende.
      if (this.syncRun) {
        this.restartWanted = true;
        return;
      }
    }
    if (Date.now() < this.restartGuardUntil) {
      this.skipRestart('Neustart nach Sync übersprungen – der Rahmen wurde gerade erst neu gestartet.');
      return;
    }
    try {
      await this.restartFrame('nach Sync');
    } catch (err) {
      this.log.warn({ err }, 'Neustart nach Sync fehlgeschlagen');
      this.setSync({ restartPlanned: false, restartAt: null, restartSkipped: `Neustart nach Sync fehlgeschlagen: ${(err as Error).message}` });
    }
  }

  /** Neustart nach Sync auslassen: protokollieren und in der Oberfläche anzeigen. */
  private skipRestart(reason: string): void {
    this.log.info(reason);
    this.restartWanted = false;
    this.setSync({ restartPlanned: false, restartAt: null, restartSkipped: reason });
  }

  /** Laufende Wartezeit vor dem Neustart nach Sync beenden, ohne neu zu starten. */
  private cancelRestartDelay(): void {
    clearTimeout(this.restartDelayTimer);
    this.restartDelayTimer = undefined;
    const done = this.restartDelayDone;
    this.restartDelayDone = undefined;
    done?.(false);
  }

  async setPower(on: boolean): Promise<void> {
    if (!this.shelly) throw new Error('SHELLY_IP ist nicht gesetzt');
    await this.shelly.setPower(on);
    if (on) {
      if (this.device.power !== true) this.onPoweredOn('App');
    } else {
      this.onPoweredOff();
    }
  }

  /**
   * Webhook des Shelly nach dem Einschalten (FA-37): Sync verzögert starten.
   * Weitere Aufrufe in der Wartezeit lösen keinen zweiten Sync aus.
   */
  powerOnHook(): { startsAt: number | null; alreadyScheduled: boolean } {
    const alreadyScheduled = Boolean(this.delayedSyncTimer);
    if (!alreadyScheduled) this.onPoweredOn('Webhook');
    return { startsAt: this.sync.startsAt, alreadyScheduled };
  }

  private scheduleDelayedSync(reason: string): void {
    if (this.delayedSyncTimer) return;
    const delay = this.cfg.powerOnSyncDelaySec * 1000;
    this.setSync({ startsAt: Date.now() + delay, phase: this.syncRun ? this.sync.phase : 'waiting' });
    this.delayedSyncTimer = setTimeout(async () => {
      this.delayedSyncTimer = undefined;
      this.setSync({ startsAt: null, phase: this.syncRun ? this.sync.phase : 'idle' });
      if (!this.card) return;
      const online = await this.card.isReachable();
      this.setDevice({ cardOnline: online, booting: !online && Date.now() < this.bootUntil });
      if (online) {
        await this.refreshSpace();
        this.requestSync(`${reason} (verzögert)`);
      } else {
        this.log.info('Karte nach dem Einschalten noch nicht erreichbar – Polling übernimmt');
      }
    }, delay);
    this.delayedSyncTimer.unref();
  }

  // --- Sync -------------------------------------------------------------

  /** Sync anstoßen. Läuft schon einer, folgt direkt danach ein weiterer Lauf. */
  requestSync(reason: string): void {
    if (!this.card || this.stopped) return;
    if (this.syncRun) {
      this.syncAgain = true;
      return;
    }
    this.syncRun = this.doSync(reason).finally(() => {
      this.syncRun = undefined;
      if (this.syncAgain && !this.stopped && this.device.cardOnline) {
        this.syncAgain = false;
        this.requestSync('Folgelauf');
        return;
      }
      this.syncAgain = false;
      // Neustart erst, wenn kein Folgelauf mehr ansteht – sonst würde er abgebrochen.
      if (this.restartWanted) {
        this.restartWanted = false;
        void this.restartAfterSync();
      }
    });
  }

  private async doSync(reason: string): Promise<void> {
    const card = this.card!;
    this.abortSync = false;
    // Läuft dieser Sync wegen eines Neustarts (Webhook/Polling danach), darf er
    // selbst keinen Neustart auslösen – auch wenn er etwas überträgt.
    const inRestartWindow = Date.now() < this.restartGuardUntil;
    this.lastAutoSyncSignature = this.planSignature;
    this.log.info({ reason }, 'Sync gestartet');
    // Wird dieser Sync etwas ändern, startet der Rahmen danach neu (Anzeige vorab).
    const restartApplies = Boolean(this.shelly) && this.cfg.restartAfterSync && !inRestartWindow;
    this.setSync({ phase: 'preparing', done: 0, total: 0, lastError: null, restartSkipped: null });
    try {
      const result = await runSync(this.named, {
        card,
        cache: this.cache,
        store: this.store,
        log: this.log.child({ mod: 'sync' }),
        deleteExtra: this.cfg.flashair.deleteExtra,
        shouldAbort: () => this.abortSync || this.stopped,
        onProgress: (p) =>
          this.setSync({
            phase: p.phase,
            done: p.done,
            total: p.total,
            ...(restartApplies && p.phase !== 'preparing' && p.total > 0 ? { restartPlanned: true } : {}),
          }),
      });
      this.store.set('cardReclaimableBytes', result.reclaimableBytes);
      if (result.freeBytes !== null) {
        this.store.set('cardFreeBytes', result.freeBytes);
        this.store.set('cardTotalBytes', result.totalBytes);
        this.setDevice({ cardFreeBytes: result.freeBytes, cardTotalBytes: result.totalBytes, cardOnline: true, booting: false });
      }
      const lastSuccessAt = Date.now();
      this.store.set('lastSyncAt', lastSuccessAt);
      this.setSync({
        phase: 'idle',
        lastSuccessAt,
        lastError: result.failed ? `${result.failed} Bilder konnten nicht übertragen werden` : null,
      });
      const changed = result.uploaded + result.deleted > 0;
      if (changed && restartApplies) this.restartWanted = true;
      else if (changed && inRestartWindow && this.shelly && this.cfg.restartAfterSync) {
        this.skipRestart('Kein Neustart nach diesem Sync – der Rahmen wurde gerade erst neu gestartet.');
      }
      this.setSync({ restartPlanned: this.restartWanted });
    } catch (err) {
      let message: string;
      if (err instanceof SyncAbortedError) message = 'Sync abgebrochen – wird beim nächsten Einschalten fortgesetzt';
      else if (err instanceof CardFullError) message = err.message;
      else message = `Sync fehlgeschlagen: ${(err as Error).message}`;
      this.log.warn({ err }, message);
      // Ein Neustart aus einem früheren Lauf bleibt geplant.
      this.setSync({ phase: 'idle', lastError: message, restartPlanned: this.restartWanted });
      if (!(err instanceof CardFullError) && !(err instanceof SyncAbortedError)) {
        const online = await card.isReachable();
        this.setDevice({ cardOnline: online });
      }
    } finally {
      this.recomputePlan('after-sync');
    }
  }
}
