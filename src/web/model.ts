import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { monthEnd, monthsBefore } from '../shared/dates.js';
import type { Folder, Selection, Snapshot } from '../shared/types.js';
import { PER_FOLDER_MAX, PER_FOLDER_MIN, WINDOW_MAX, WINDOW_MIN } from '../shared/types.js';
import { actionError, api, connected, onServerMessage } from './store.js';

// Zustand und abgeleitete Werte der Oberfläche. Mobil- und Desktop-Layout
// nutzen dasselbe Modell, nur die Anordnung unterscheidet sich.

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const TICKS = [1, 6, 12, 18, 24, 30, 36];
export const PAGE_SIZES = [12, 24, 48, 0];
export const PER_OPTIONS = [10, 25, 50, 100];
const TIMELINE_START = 1991;

export type View = 'grid' | 'list';
export type Group = 'year' | 'month';
export type Sheet = 'filter' | 'settings' | null;
export type FrameStatus = 'on' | 'up' | 'rm' | '';

export const fmt = (n: number) => n.toLocaleString('de-DE');
export const de = (iso: string) => iso.split('-').reverse().join('.');
export const winLabel = (n: number) => (n === 1 ? 'Letzter Monat' : `Letzte ${n} Monate`);
export const winSub = (n: number) =>
  n % 12 === 0 ? `· ${n / 12} ${n === 12 ? 'Jahr' : 'Jahre'}` : n > 12 ? `· ≈ ${(n / 12).toFixed(1).replace('.', ',')} Jahre` : '';
const ymLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]!.slice(0, 3)} ${y}`;
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function timeLabel(ms: number | null): string {
  if (!ms) return 'noch nie';
  const d = new Date(ms);
  return `${d.toLocaleDateString('de-DE')} · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.mode !== b.mode || a.scope !== b.scope) return false;
  if (a.mode === 'auto' && a.windowMonths !== b.windowMonths) return false;
  if (a.scope === 'limit' && a.perFolder !== b.perFolder) return false;
  if (a.mode === 'manual') {
    if (a.manual.length !== b.manual.length) return false;
    const set = new Set(a.manual);
    return b.manual.every((id) => set.has(id));
  }
  return true;
}

function usePersisted<T extends string | number>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(`pfs.${key}`);
    const parsed = (typeof initial === 'number' ? Number(raw) : raw) as T;
    return raw !== null && allowed.includes(parsed) ? parsed : initial;
  });
  const set = (v: T) => {
    localStorage.setItem(`pfs.${key}`, String(v));
    setValue(v);
  };
  return [value, set] as const;
}

/** Restzeit für Countdowns: „45 s“ bzw. „9:50 min“ */
const countdown = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min`);

/** Sekündlich neu rendern, solange `active` (für Countdowns). */
function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export interface FolderVM extends Folder {
  sel: boolean;
  status: FrameStatus;
  statusLabel: string;
  countLabel: string;
  countLong: string;
  dateLabel: string;
  aria: string;
}

export interface GroupVM {
  key: string;
  label: string;
  sub: string;
  folders: FolderVM[];
  allSelected: boolean;
}

export interface MonthBar {
  ym: string;
  height: number;
  inRange: boolean;
  jan: boolean;
  year: string;
  anchor: boolean;
  aria: string;
}

const STATUS_LABEL: Record<FrameStatus, string> = { on: 'Auf dem Rahmen', up: 'Upload ausstehend', rm: 'Wird entfernt', '': '' };

export function useModel(snap: Snapshot) {
  // --- Entwurf der Auswahl (bis „Speichern“) ---------------------------
  const [draft, setDraft] = useState<Selection>(snap.selection);
  const saved = useRef(snap.selection);
  useEffect(
    () =>
      onServerMessage((m) => {
        if (m.type !== 'selection' && m.type !== 'snapshot') return;
        const previous = saved.current;
        saved.current = m.selection;
        // Ungespeicherte Änderungen bleiben; sonst den neuen Stand übernehmen.
        setDraft((d) => (sameSelection(d, previous) ? m.selection : d));
      }),
    [],
  );

  const [view, setView] = usePersisted<View>('view', 'grid', ['grid', 'list']);
  const [group, setGroup] = usePersisted<Group>('group', 'year', ['year', 'month']);
  const [pageSize, setPageSizeRaw] = usePersisted<number>('pageSize', 12, PAGE_SIZES);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tlStart, setTlStart] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);

  const { folders, today, device, sync, frame, plan } = snap;
  const auto = draft.mode === 'auto';
  const lim = draft.scope === 'limit';
  const aFrom = monthsBefore(today, draft.windowMonths);

  const list = useMemo(() => {
    if (auto) return folders.filter((f) => f.date >= aFrom && f.date <= today);
    const needle = q.trim().toLowerCase();
    return folders.filter((f) => (!from || f.date >= from) && (!to || f.date <= to) && (!needle || f.name.toLowerCase().includes(needle)));
  }, [folders, auto, aFrom, today, q, from, to]);

  const eff = useMemo(() => (auto ? new Set(list.map((f) => f.id)) : new Set(draft.manual)), [auto, list, draft.manual]);
  const n = (f: Folder) => (lim ? Math.min(draft.perFolder, f.imageCount) : f.imageCount);

  const dirty = !sameSelection(draft, snap.selection);
  const syncing = sync.phase === 'preparing' || sync.phase === 'uploading' || sync.phase === 'deleting';
  const online = device.cardOnline;
  useTicker(sync.startsAt !== null || sync.restartAt !== null);

  // --- Paginierung und Gruppen -----------------------------------------
  const pages = pageSize ? Math.max(1, Math.ceil(list.length / pageSize)) : 1;
  const currentPage = Math.min(page, pages - 1);
  const pageList = pageSize ? list.slice(currentPage * pageSize, currentPage * pageSize + pageSize) : list;

  const toVM = (f: Folder): FolderVM => {
    const sel = eff.has(f.id);
    const fr = frame[f.id];
    const status: FrameStatus = sel && fr?.onCard && fr.complete ? 'on' : sel ? 'up' : fr?.onCard ? 'rm' : '';
    const cut = lim && f.imageCount > draft.perFolder;
    const dateLabel = de(f.date);
    return {
      ...f,
      sel,
      status,
      statusLabel: STATUS_LABEL[status],
      countLabel: cut ? `${draft.perFolder} / ${fmt(f.imageCount)}` : fmt(f.imageCount),
      countLong: cut ? `${draft.perFolder} von ${fmt(f.imageCount)} Bildern` : `${fmt(f.imageCount)} Bilder`,
      dateLabel,
      aria: `${auto ? 'Automatisch enthalten' : sel ? 'Abwählen' : 'Auswählen'}: ${f.title}, ${dateLabel}${status ? `, ${STATUS_LABEL[status]}` : ''}`,
    };
  };

  const groups: GroupVM[] = [];
  const byKey = new Map<string, GroupVM>();
  for (const f of pageList) {
    const [y, m] = f.date.split('-') as [string, string];
    const key = group === 'year' ? y : `${y}-${m}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: group === 'year' ? y : `${MONTHS[Number(m) - 1]} ${y}`, sub: '', folders: [], allSelected: false };
      byKey.set(key, g);
      groups.push(g);
    }
    g.folders.push(toVM(f));
  }
  for (const g of groups) {
    const items = g.folders.reduce((a, f) => a + f.imageCount, 0);
    g.sub = `${g.folders.length} Ordner · ${fmt(items)} Bilder`;
    g.allSelected = g.folders.every((f) => draft.manual.includes(f.id));
  }

  // --- Summen ----------------------------------------------------------
  const selF = folders.filter((f) => eff.has(f.id));
  const selAll = selF.reduce((a, f) => a + f.imageCount, 0);
  const selN = selF.reduce((a, f) => a + n(f), 0);
  const listItems = list.reduce((a, f) => a + f.imageCount, 0);

  // --- Zeitstrahl und Balken -------------------------------------------
  const monthSums = useMemo(() => {
    const sums = new Map<string, { images: number; folders: number }>();
    for (const f of folders) {
      const k = f.date.slice(0, 7);
      const s = sums.get(k) ?? { images: 0, folders: 0 };
      s.images += f.imageCount;
      s.folders += 1;
      sums.set(k, s);
    }
    return sums;
  }, [folders]);

  const months = (startYm: string, r0: string, r1: string, withAnchor: boolean): MonthBar[] => {
    const out: MonthBar[] = [];
    const endYm = today.slice(0, 7);
    let [y, m] = startYm.split('-').map(Number) as [number, number];
    for (;;) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (ym > endYm) break;
      const s = monthSums.get(ym);
      out.push({
        ym,
        height: s?.images ? Math.min(56, Math.round(8 + Math.sqrt(s.images) * 1.45)) : 3,
        inRange: (!r0 || ym >= r0.slice(0, 7)) && (!r1 || ym <= r1.slice(0, 7)),
        jan: m === 1,
        year: String(y),
        anchor: withAnchor && tlStart === ym,
        aria: `${MONTHS[m - 1]} ${y}: ${s?.folders ?? 0} Ordner`,
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  };

  const autoStart = monthsBefore(today, 35).slice(0, 7);
  const autoMonths = months(autoStart, aFrom, '', false);
  const axis: { label: string; flex: number }[] = [];
  for (const bar of autoMonths) {
    const last = axis.at(-1);
    if (last && last.label === bar.year) last.flex += 1;
    else axis.push({ label: bar.year, flex: 1 });
  }
  for (const a of axis) if (a.flex < 4) a.label = `’${a.label.slice(2)}`;
  const manMonths = months(`${TIMELINE_START}-01`, from, to, true);

  // --- Status ----------------------------------------------------------
  const lastSync = timeLabel(sync.lastSuccessAt);
  const savedDesc = snap.selection.mode === 'auto' ? `Automatisch · ${winLabel(snap.selection.windowMonths)}` : 'Manuelle Auswahl';
  let st: { cls: 'ok' | 'pending' | 'syncing' | 'dirty'; title: string; text: string };
  if (syncing) {
    const text =
      sync.total === 0
        ? 'Karte wird geprüft …'
        : sync.phase === 'deleting'
          ? `Entferne überzählige Dateien · ${sync.done} von ${sync.total}`
          : `${fmt(sync.done)} von ${fmt(sync.total)} Dateien übertragen …`;
    st = { cls: 'syncing', title: 'Synchronisiere', text: sync.restartPlanned ? `${text} Danach startet der Rahmen neu.` : text };
  } else if (sync.restartPlanned && !device.restarting) {
    // Neustart nach Sync (FA-36): Wartezeit läuft, damit die Karte fertig schreibt.
    const sec = sync.restartAt !== null ? Math.max(0, Math.ceil((sync.restartAt - Date.now()) / 1000)) : 0;
    st = {
      cls: 'pending',
      title: 'Neustart geplant',
      text: sec > 0 ? `Sync fertig – Rahmen startet in ${countdown(sec)} neu, damit er die neuen Bilder lädt.` : 'Sync fertig – Rahmen startet gleich neu.',
    };
  } else if (sync.startsAt !== null) {
    const sec = Math.max(0, Math.ceil((sync.startsAt - Date.now()) / 1000));
    st = { cls: 'pending', title: 'Sync ausstehend', text: `Rahmen startet – Sync beginnt in ${sec} s.` };
  } else if (sync.pending && !dirty) {
    let text: string;
    if (device.power === false) text = 'Rahmen ist ausgeschaltet – Sync startet nach dem Einschalten automatisch.';
    else if (!online) text = 'Gespeichert – startet automatisch, sobald der Rahmen online ist.';
    else text = sync.lastError ?? 'Noch nicht vollständig auf dem Rahmen.';
    st = { cls: 'pending', title: 'Sync ausstehend', text };
  } else if (dirty) {
    st = { cls: 'dirty', title: 'Nicht gespeichert', text: `Zuletzt synchronisiert ${lastSync}` };
  } else {
    st = {
      cls: 'ok',
      title: 'Aktuell',
      text: sync.lastError ?? (sync.restartSkipped ? `Zuletzt synchronisiert ${lastSync} · ${sync.restartSkipped}` : `Zuletzt synchronisiert ${lastSync}`),
    };
  }

  const tooBig = plan.availableBytes !== null && !dirty && plan.estimatedBytes > plan.availableBytes;
  const scopeResult =
    `Aktuelle Auswahl: ${fmt(selN)}${lim ? ` von ${fmt(selAll)}` : ''} Bildern aus ${selF.length} Ordnern werden übertragen.` +
    (device.cardFreeBytes !== null ? ` Frei auf der Karte: ${formatBytes(device.cardFreeBytes)}.` : '');
  const spaceWarning = tooBig
    ? `Die Auswahl (ca. ${formatBytes(plan.estimatedBytes)}) ist größer als der verfügbare Speicher der Karte (${formatBytes(plan.availableBytes!)}). Der Sync überträgt, bis die Karte voll ist.`
    : null;

  const firstOnFrame = folders.find((f) => frame[f.id]?.onCard);
  const hasRange = Boolean(from || to);

  // --- Aktionen --------------------------------------------------------
  const patch = (p: Partial<Selection>) => setDraft((d) => ({ ...d, ...p }));
  const setWin = (v: number) => {
    patch({ windowMonths: Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, v)) });
    setPage(0);
  };
  const setPer = (v: number) => {
    if (Number.isNaN(v)) return;
    patch({ perFolder: Math.max(PER_FOLDER_MIN, Math.min(PER_FOLDER_MAX, Math.round(v))) });
  };
  const toggle = (id: string) => {
    if (auto) return;
    setDraft((d) => ({ ...d, manual: d.manual.includes(id) ? d.manual.filter((x) => x !== id) : [...d.manual, id] }));
  };
  const toggleGroup = (g: GroupVM) => {
    const ids = g.folders.map((f) => f.id);
    setDraft((d) => {
      const set = new Set(d.manual);
      for (const id of ids) {
        if (g.allSelected) set.delete(id);
        else set.add(id);
      }
      return { ...d, manual: [...set] };
    });
  };
  const pickMonth = (ym: string) => {
    setPage(0);
    if (!tlStart) {
      setTlStart(ym);
      setFrom(`${ym}-01`);
      setTo(monthEnd(ym));
      return;
    }
    const lo = tlStart < ym ? tlStart : ym;
    const hi = tlStart < ym ? ym : tlStart;
    setTlStart(null);
    setFrom(`${lo}-01`);
    setTo(monthEnd(hi));
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // Meldung steht in actionError
    } finally {
      setBusy(false);
    }
  };

  const onSync = () =>
    run(async () => {
      if (dirty) await api.saveSelection({ ...draft, manual: [...draft.manual].sort() });
      else if (online) await api.syncNow();
    });

  const togglePower = () => run(() => api.power(device.power !== true));
  const restart = () => run(() => api.restart());

  return {
    snap,
    draft,
    auto,
    lim,
    dirty,
    syncing,
    online,
    busy,
    connected: connected.value,
    actionError: actionError.value,
    st,
    heroTitle: savedDesc,
    frameThumb: firstOnFrame ? `/api/thumbs/${firstOnFrame.id}` : null,
    frameBadge: device.restarting ? 'Neustart …' : device.power === false ? 'Ausgeschaltet' : device.booting ? 'Startet …' : 'Nicht erreichbar',
    frameOffline: device.power === false || !online,
    devLabel: device.restarting ? 'Neustart …' : device.booting ? 'startet …' : online ? 'online' : 'offline',
    devAria: !device.cardConfigured
      ? 'Keine Karte konfiguriert (FLASHAIR_IP)'
      : device.restarting
        ? 'Rahmen wird neu gestartet …'
        : device.power === false
          ? 'Rahmen ausgeschaltet – offline'
          : device.booting
            ? 'Rahmen startet …'
            : `Rahmen ${online ? 'online' : 'offline'}`,
    pwrLabel: device.booting ? 'Startet' : device.power ? 'An' : 'Aus',
    pwrAria:
      device.power === null
        ? 'Shelly nicht erreichbar'
        : device.booting
          ? 'Rahmen startet …'
          : device.power
            ? 'Rahmen ist eingeschaltet – ausschalten'
            : 'Rahmen ist ausgeschaltet – einschalten',
    pwrDisabled: device.booting || device.power === null || busy,
    togglePower,
    restartAria:
      device.restarting || device.booting
        ? 'Rahmen startet …'
        : !device.power
          ? 'Rahmen ist ausgeschaltet'
          : sync.restartPlanned
            ? 'Neustart nach Sync ist geplant – jetzt neu starten'
            : 'Rahmen neu starten',
    restartPlanned: sync.restartPlanned && !device.restarting,
    restartDisabled: device.power !== true || device.booting || syncing || busy,
    restart,

    // Auswahl
    setAuto: () => {
      patch({ mode: 'auto' });
      setPage(0);
    },
    // FA-21: Beim Wechsel zu Manuell wird die Automatik-Auswahl übernommen.
    setManual: () => setDraft((d) => (d.mode === 'auto' ? { ...d, mode: 'manual', manual: [...eff] } : d)),
    win: draft.windowMonths,
    winLabel: winLabel(draft.windowMonths),
    winUnit: draft.windowMonths === 1 ? 'Monat' : 'Monate',
    winSub: winSub(draft.windowMonths),
    winPct: `${(((draft.windowMonths - 1) / (WINDOW_MAX - 1)) * 100).toFixed(2)}%`,
    setWin,
    autoMonths,
    axis,
    autoText: `Aktuell ${list.length} Ordner mit ${fmt(selN)} Bildern (ab ${de(aFrom)}). Neue Ordner kommen automatisch dazu, ältere fallen heraus.`,
    clearSel: () => patch({ manual: [] }),

    // Filter
    q,
    setQ: (v: string) => {
      setQ(v);
      setPage(0);
    },
    from,
    to,
    setFrom: (v: string) => {
      setFrom(v);
      setTlStart(null);
      setPage(0);
    },
    setTo: (v: string) => {
      setTo(v);
      setTlStart(null);
      setPage(0);
    },
    hasRange,
    manMonths,
    pickMonth,
    tlHint: tlStart ? `Start ${ymLabel(tlStart)} – jetzt Endmonat antippen` : 'Startmonat, dann Endmonat antippen',
    relText: hasRange ? `Angezeigt: ${from ? de(from) : 'Anfang'} – ${to ? de(to) : 'heute'}` : `Kein Zeitraum gesetzt – alle Ordner seit ${TIMELINE_START} sichtbar.`,
    resetFilter: () => {
      setFrom('');
      setTo('');
      setQ('');
      setTlStart(null);
      setPage(0);
    },
    showText: `${list.length} Ordner anzeigen`,

    // Übertragung
    setScope: (scope: Selection['scope']) => patch({ scope }),
    per: draft.perFolder,
    setPer,
    scopeShort: lim ? `max. ${draft.perFolder} je Ordner` : 'Alle Bilder',
    scopeResult,
    spaceWarning,
    shuffleAvailable: snap.naming.order === 'random',
    shuffle: () => run(() => api.shuffle()),

    // Liste
    view,
    setView,
    group,
    setGroup,
    groups,
    toggle,
    toggleGroup,
    isEmpty: list.length === 0,
    emptyText: auto ? 'In diesem Zeitraum gibt es keine Ordner.' : 'Keine Ordner für diesen Zeitraum bzw. diese Suche.',
    resultText: `${auto ? 'Im Zeitraum: ' : 'Sichtbar: '}${list.length} Ordner · ${fmt(listItems)} Bilder`,
    scan: snap.scan,
    rescan: () => run(() => api.scan()),

    // Paginierung (FA-13)
    pageSize,
    setPageSize: (v: number) => {
      setPageSizeRaw(v);
      setPage(0);
    },
    pages,
    page: currentPage,
    pageText: `${currentPage + 1} / ${pages}`,
    rangeText: list.length
      ? `${pageSize ? `${currentPage * pageSize + 1}–${Math.min(list.length, (currentPage + 1) * pageSize)}` : `1–${list.length}`} von ${list.length}`
      : '0 Ordner',
    prev: () => setPage(Math.max(0, currentPage - 1)),
    next: () => setPage(Math.min(pages - 1, currentPage + 1)),

    // Sheets (mobil)
    sheet,
    setSheet,

    // Speichern & Sync
    selCount: selF.length,
    selItems: fmt(selN),
    footSummary: `${auto ? winLabel(draft.windowMonths) : 'Manuelle Auswahl'} · ${lim ? `max. ${draft.perFolder} je Ordner` : 'alle Bilder'}`,
    btnLabel: syncing ? 'Läuft …' : online ? (dirty ? 'Speichern & Sync' : 'Jetzt syncen') : dirty ? 'Speichern' : 'Gespeichert',
    btnDisabled: syncing || busy || (!dirty && !online),
    onSync,
  };
}

export type Model = ReturnType<typeof useModel>;
