// Datentypen, die Server und Oberfläche gemeinsam nutzen (REST und WebSocket).

export type SelectionMode = 'auto' | 'manual';
export type Scope = 'all' | 'limit';

/** Gespeicherte Auswahl (Soll), serverseitig in SQLite. */
export interface Selection {
  mode: SelectionMode;
  /** Automatik: letzte 1–36 Monate */
  windowMonths: number;
  /** Manuell: Ordner-IDs */
  manual: string[];
  scope: Scope;
  /** Begrenzung: 1–999 Bilder je Ordner */
  perFolder: number;
}

export interface Folder {
  /** Stabile ID aus dem relativen Pfad */
  id: string;
  /** Ordnername, z. B. 2026-10-18_Herbstwanderung_Allgäu */
  name: string;
  /** Pfad relativ zum Bilderverzeichnis, z. B. 2026/2026-10-18_Herbstwanderung_Allgäu */
  path: string;
  /** yyyy-mm-dd */
  date: string;
  title: string;
  imageCount: number;
}

export interface ScanState {
  running: boolean;
  lastScanAt: number | null;
  /** Fehlermeldung, wenn das Bilderverzeichnis zuletzt nicht lesbar war */
  error: string | null;
}

/** Was je Ordner auf der Karte liegt. */
export interface FrameFolderState {
  /** Mindestens ein Bild des Ordners liegt auf der Karte */
  onCard: boolean;
  /** Alle Soll-Bilder des Ordners liegen auf der Karte */
  complete: boolean;
}

export interface DeviceState {
  /** FLASHAIR_IP gesetzt */
  cardConfigured: boolean;
  cardOnline: boolean;
  cardFreeBytes: number | null;
  cardTotalBytes: number | null;
  /** SHELLY_IP gesetzt */
  powerConfigured: boolean;
  /** Schaltzustand laut Shelly; null = unbekannt bzw. Shelly nicht erreichbar */
  power: boolean | null;
  /** Nach dem Einschalten, bis die Karte antwortet oder BOOT_TIMEOUT_SEC abläuft */
  booting: boolean;
  /** Neustart läuft: Shelly ist kurz aus und schaltet sich selbst wieder ein */
  restarting: boolean;
}

export type SyncPhase = 'idle' | 'waiting' | 'preparing' | 'uploading' | 'deleting';

export interface SyncState {
  phase: SyncPhase;
  /** Gespeicherte Auswahl ist noch nicht auf der Karte */
  pending: boolean;
  done: number;
  total: number;
  lastSuccessAt: number | null;
  lastError: string | null;
  /** Unix-ms, wann ein verzögerter Sync (nach dem Einschalten) startet */
  startsAt: number | null;
  /** Nach diesem Sync startet der Rahmen neu (RESTART_AFTER_SYNC) */
  restartPlanned: boolean;
  /** Unix-ms, wann der geplante Neustart nach der Wartezeit (RESTART_DELAY_SEC) erfolgt */
  restartAt: number | null;
  /** Warum der Neustart nach dem letzten Sync ausgelassen wurde; null = nicht ausgelassen */
  restartSkipped: string | null;
}

export interface PlanSummary {
  folders: number;
  images: number;
  /** Bilder ohne Begrenzung */
  imagesTotal: number;
  /** Geschätzter Platzbedarf auf der Karte */
  estimatedBytes: number;
  /** Platz, den die Auswahl auf der Karte maximal belegen kann */
  availableBytes: number | null;
}

export interface Snapshot {
  version: string;
  today: string;
  folders: Folder[];
  scan: ScanState;
  selection: Selection;
  frame: Record<string, FrameFolderState>;
  device: DeviceState;
  sync: SyncState;
  plan: PlanSummary;
  naming: { mode: 'dcim' | 'original'; order: 'original' | 'random' };
}

export type ServerMessage =
  | ({ type: 'snapshot' } & Snapshot)
  | { type: 'folders'; folders: Folder[]; scan: ScanState }
  | { type: 'scan'; scan: ScanState }
  | { type: 'selection'; selection: Selection; plan: PlanSummary }
  | { type: 'frame'; frame: Record<string, FrameFolderState> }
  | { type: 'device'; device: DeviceState }
  | { type: 'sync'; sync: SyncState }
  | { type: 'plan'; plan: PlanSummary; today: string };

export const WINDOW_MIN = 1;
export const WINDOW_MAX = 36;
export const PER_FOLDER_MIN = 1;
export const PER_FOLDER_MAX = 999;

export const DEFAULT_SELECTION: Selection = {
  mode: 'auto',
  windowMonths: 12,
  manual: [],
  scope: 'all',
  perFolder: 50,
};
