import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as I from './icons.js';
import type { FolderVM, GroupVM, Model } from './model.js';
import { PAGE_SIZES, PER_OPTIONS, TICKS } from './model.js';

/** Vorschaubild: lädt lazy, bis dahin Platzhalter mit Schimmer (FA-07). */
export function Thumb({ id, children }: { id: string; children?: ComponentChildren }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <span class={`ph ${state === 'loading' ? 'loading' : ''}`}>
      {state !== 'error' && (
        <img
          src={`/api/thumbs/${id}`}
          alt=""
          loading="lazy"
          decoding="async"
          class={state === 'ok' ? 'ok' : ''}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {children}
    </span>
  );
}

export function StatusPill({ m }: { m: Model }) {
  return (
    <span class={`spill ${m.st.cls === 'ok' ? '' : m.st.cls}`}>
      {m.st.cls === 'ok' && <I.Check sw={3} />}
      {m.st.cls === 'pending' && <I.Clock />}
      {m.st.cls === 'syncing' && <I.Refresh class="spin" />}
      {m.st.cls === 'dirty' && <I.Pencil />}
      {m.st.title}
    </span>
  );
}

export function MiniFrame({ m }: { m: Model }) {
  return (
    <span class={`mframe ${m.frameOffline ? 'offl' : ''}`} aria-hidden="true">
      {m.frameThumb && <img src={m.frameThumb} alt="" />}
      <span class="mfov">{m.frameBadge}</span>
    </span>
  );
}

export function DevicePill({ m, withLabel }: { m: Model; withLabel?: boolean }) {
  const { device } = m.snap;
  return (
    <div class="devpill">
      <span class={`net ${m.online ? 'on' : ''}`} role="status" aria-label={m.devAria} title={m.devAria}>
        {m.online ? <I.WifiOn /> : <I.WifiOff />}
        <span aria-hidden="true">{m.devLabel}</span>
      </span>
      {device.powerConfigured && (
        <button
          class={`pwr ${device.power ? 'on' : ''}`}
          onClick={m.togglePower}
          disabled={m.pwrDisabled}
          aria-pressed={device.power === true}
          aria-label={m.pwrAria}
          title={m.pwrAria}
        >
          <I.Power />
          {withLabel && <span aria-hidden="true">{m.pwrLabel}</span>}
        </button>
      )}
      {device.powerConfigured && (
        <button class={`pwr ${m.restartPlanned ? 'planned' : ''}`} onClick={m.restart} disabled={m.restartDisabled} aria-label={m.restartAria} title={m.restartAria}>
          <I.Restart />
          {withLabel && <span aria-hidden="true">Neustart</span>}
        </button>
      )}
    </div>
  );
}

export function ModeSwitch({ m }: { m: Model }) {
  return (
    <div class="mode" role="radiogroup" aria-label="Auswahlmodus">
      <button class={`mbtn ${m.auto ? 'act' : ''}`} role="radio" aria-checked={m.auto} onClick={m.setAuto}>
        <span class="mi">
          <I.AutoIcon />
        </span>
        <span>
          <span class="mt">Automatisch</span>
          <span class="ms">nach Zeitraum</span>
        </span>
      </button>
      <button class={`mbtn ${m.auto ? '' : 'act'}`} role="radio" aria-checked={!m.auto} onClick={m.setManual}>
        <span class="mi">
          <I.ManualIcon />
        </span>
        <span>
          <span class="mt">Manuell</span>
          <span class="ms">Ordner einzeln</span>
        </span>
      </button>
    </div>
  );
}

export function AutoWindow({ m }: { m: Model }) {
  return (
    <>
      <div class="lbl" style={{ textAlign: 'center' }}>
        Immer synchronisieren · letzte
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button class="rbtn" onClick={() => m.setWin(m.win - 1)} disabled={m.win <= 1} aria-label="Einen Monat weniger">
          <I.Minus />
        </button>
        <div style={{ flex: 1 }} aria-live="polite">
          <div class="bignum">{m.win}</div>
          <div class="bigunit">
            {m.winUnit} <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{m.winSub}</span>
          </div>
        </div>
        <button class="rbtn" onClick={() => m.setWin(m.win + 1)} disabled={m.win >= 36} aria-label="Einen Monat mehr">
          <I.Plus />
        </button>
      </div>
      <div>
        <input
          class="slider"
          style={{ '--p': m.winPct }}
          type="range"
          min={1}
          max={36}
          step={1}
          value={m.win}
          onInput={(e) => m.setWin(Number(e.currentTarget.value))}
          aria-label="Zeitraum in Monaten"
          aria-valuetext={m.winLabel}
        />
        <div class="ticks">
          {TICKS.map((t) => (
            <button
              key={t}
              class={`tick ${t === m.win ? 'act' : ''}`}
              style={{ left: `calc(14px + (100% - 28px) * ${((t - 1) / 35).toFixed(4)})` }}
              onClick={() => m.setWin(t)}
              aria-label={t === 1 ? 'Letzter Monat' : `Letzte ${t} Monate`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div aria-hidden="true">
        <div class="bars">
          {m.autoMonths.map((b) => (
            <span key={b.ym} class={`bar ${b.inRange ? 'in' : ''}`} style={{ height: `${b.height}px` }} />
          ))}
        </div>
        <div class="axis">
          {m.axis.map((a) => (
            <span key={a.label} style={{ flex: a.flex }}>
              {a.label}
            </span>
          ))}
        </div>
      </div>
      <InfoBox>{m.autoText}</InfoBox>
    </>
  );
}

export function InfoBox({ children, warn, icon }: { children: ComponentChildren; warn?: boolean; icon?: 'calendar' }) {
  return (
    <div class={`info ${warn ? 'warn' : ''}`} role={warn ? 'alert' : undefined}>
      {icon === 'calendar' ? <I.Calendar size={16} /> : <I.Info />}
      <span>{children}</span>
    </div>
  );
}

export function SearchField({ m, placeholder }: { m: Model; placeholder: string }) {
  return (
    <label class="search">
      <I.Search />
      <input type="search" placeholder={placeholder} aria-label="Ordnername suchen" value={m.q} onInput={(e) => m.setQ(e.currentTarget.value)} />
    </label>
  );
}

/** Zeitstrahl 1991 bis heute, monatsgenau (FA-20). Startet rechts beim aktuellen Monat. */
export function Timeline({ m }: { m: Model }) {
  return (
    <div class="tl" role="group" aria-label="Zeitstrahl 1991 bis heute">
      {[...m.manMonths].reverse().map((b) => (
        <button
          key={b.ym}
          class={`mc ${b.inRange ? 'in' : ''} ${b.jan ? 'jan' : ''} ${b.anchor ? 'anchor' : ''}`}
          onClick={() => m.pickMonth(b.ym)}
          aria-label={b.aria}
          aria-pressed={b.anchor}
          title={b.aria}
        >
          <span class="b" style={{ height: `${b.height}px` }} />
          {b.jan && <span class="ylab">{b.year}</span>}
        </button>
      ))}
    </div>
  );
}

export function DateRange({ m }: { m: Model }) {
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <label class="fld">
        Von
        <input class="inp" type="date" min="1991-01-01" max={m.snap.today} value={m.from} onChange={(e) => m.setFrom(e.currentTarget.value)} />
      </label>
      <label class="fld">
        Bis
        <input class="inp" type="date" min="1991-01-01" max={m.snap.today} value={m.to} onChange={(e) => m.setTo(e.currentTarget.value)} />
      </label>
    </div>
  );
}

export function ScopeSettings({ m }: { m: Model }) {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} role="radiogroup" aria-label="Umfang pro Ordner">
        <button class={`opt ${m.lim ? '' : 'act'}`} role="radio" aria-checked={!m.lim} onClick={() => m.setScope('all')}>
          <span class="radio" />
          <span>
            <span class="ot">Alle Bilder</span>
            <span class="ox">Jeder Ordner wird vollständig übertragen.</span>
          </span>
        </button>
        <button class={`opt ${m.lim ? 'act' : ''}`} role="radio" aria-checked={m.lim} onClick={() => m.setScope('limit')}>
          <span class="radio" />
          <span>
            <span class="ot">Begrenzt pro Ordner</span>
            <span class="ox">Je Ordner höchstens die eingestellte Anzahl Bilder.</span>
          </span>
        </button>
      </div>
      {m.lim && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span class="lbl" id="per-label">
            Bilder pro Ordner
          </span>
          <div class="step">
            <button class="rbtn" onClick={() => m.setPer(m.per - 5)} disabled={m.per <= 1} aria-label="Weniger">
              <I.Minus />
            </button>
            <input
              type="number"
              min={1}
              max={999}
              value={m.per}
              onChange={(e) => m.setPer(Number(e.currentTarget.value))}
              aria-labelledby="per-label"
            />
            <button class="rbtn" onClick={() => m.setPer(m.per + 5)} disabled={m.per >= 999} aria-label="Mehr">
              <I.Plus />
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {PER_OPTIONS.map((k) => (
              <button key={k} class={`pill ${m.per === k ? 'act' : ''}`} onClick={() => m.setPer(k)} aria-pressed={m.per === k}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
      <InfoBox>{m.scopeResult}</InfoBox>
      {m.spaceWarning && <InfoBox warn>{m.spaceWarning}</InfoBox>}
      {m.shuffleAvailable && (
        <button class="sec" onClick={m.shuffle} disabled={m.busy}>
          Reihenfolge neu mischen
        </button>
      )}
    </>
  );
}

export function ViewSwitch({ m, long }: { m: Model; long?: boolean }) {
  return (
    <>
      <div class="seg" role="group" aria-label="Ansicht">
        <button class={m.view === 'grid' ? 'act' : ''} onClick={() => m.setView('grid')} aria-pressed={m.view === 'grid'}>
          <I.GridIcon />
          Kacheln
        </button>
        <button class={m.view === 'list' ? 'act' : ''} onClick={() => m.setView('list')} aria-pressed={m.view === 'list'}>
          <I.ListIcon />
          Liste
        </button>
      </div>
      <div class="seg" role="group" aria-label="Gruppierung">
        <button class={m.group === 'year' ? 'act' : ''} onClick={() => m.setGroup('year')} aria-pressed={m.group === 'year'}>
          {long ? 'Nach Jahr' : 'Jahr'}
        </button>
        <button class={m.group === 'month' ? 'act' : ''} onClick={() => m.setGroup('month')} aria-pressed={m.group === 'month'}>
          {long ? 'Nach Monat' : 'Monat'}
        </button>
      </div>
    </>
  );
}

function FrameBadge({ f }: { f: FolderVM }) {
  return f.status ? <span class={`fs ${f.status === 'on' ? '' : f.status}`}>{f.statusLabel}</span> : null;
}

function Tile({ f, m }: { f: FolderVM; m: Model }) {
  return (
    <button
      class={`tile ${m.auto ? 'auto' : f.sel ? 'sel' : ''}`}
      onClick={() => m.toggle(f.id)}
      disabled={m.auto}
      aria-pressed={m.auto ? undefined : f.sel}
      aria-label={f.aria}
    >
      <Thumb id={f.id}>
        <span class="check">
          <I.Check />
        </span>
        <FrameBadge f={f} />
        <span class="cnt">
          <I.ImageIcon />
          {f.countLabel}
        </span>
      </Thumb>
      <span class="meta">
        <span class="name">{f.title}</span>
        <span class="date">{f.dateLabel}</span>
      </span>
    </button>
  );
}

function Row({ f, m, desktop }: { f: FolderVM; m: Model; desktop?: boolean }) {
  const check = !m.auto && (
    <span class="check">
      <I.Check />
    </span>
  );
  return (
    <button
      class={`row ${m.auto ? 'auto' : f.sel ? 'sel' : ''}`}
      onClick={() => m.toggle(f.id)}
      disabled={m.auto}
      aria-pressed={m.auto ? undefined : f.sel}
      aria-label={f.aria}
    >
      <Thumb id={f.id} />
      {desktop ? (
        <>
          <span class="rname">
            <span class="name">{f.title}</span>
            <span class="fname">{f.name}</span>
          </span>
          <span class="rcol">
            <FrameBadge f={f} />
          </span>
          <span class="rcol">{f.dateLabel}</span>
          <span class="rcol" style={{ textAlign: 'right' }}>
            {f.countLong}
          </span>
        </>
      ) : (
        <span class="rinfo">
          <span class="name">{f.title}</span>
          <span class="fname">{f.name}</span>
          <span class="rmeta">
            <span>{f.countLong}</span>
            <FrameBadge f={f} />
          </span>
        </span>
      )}
      {check}
    </button>
  );
}

export function FolderGroups({ m, desktop }: { m: Model; desktop?: boolean }) {
  return (
    <>
      {m.groups.map((g: GroupVM) => (
        <section key={g.key} aria-label={g.label}>
          <div class="gh">
            <h2>{g.label}</h2>
            <span class="gsub">{g.sub}</span>
            {!m.auto && (
              <button class="link" style={desktop ? { marginLeft: 'auto' } : undefined} onClick={() => m.toggleGroup(g)}>
                {g.allSelected ? 'Keine' : 'Alle'}
                {desktop ? ' auswählen' : ''}
              </button>
            )}
          </div>
          {m.view === 'grid' ? (
            <div class="grid">
              {g.folders.map((f) => (
                <Tile key={f.id} f={f} m={m} />
              ))}
            </div>
          ) : (
            <div class="list">
              {g.folders.map((f) => (
                <Row key={f.id} f={f} m={m} desktop={desktop} />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

export function Pager({ m, desktop }: { m: Model; desktop?: boolean }) {
  return (
    <div class="pager">
      <label class="psize">
        Zeige
        <select class="sel-in" value={String(m.pageSize)} onChange={(e) => m.setPageSize(Number(e.currentTarget.value))} aria-label="Ordner pro Seite">
          {PAGE_SIZES.map((k) => (
            <option key={k} value={String(k)}>
              {k ? String(k) : 'Alle'}
            </option>
          ))}
        </select>
        {desktop ? 'Ordner pro Seite' : <span style={{ color: 'var(--ink3)', fontWeight: 500 }}>{m.rangeText}</span>}
      </label>
      {desktop && <span style={{ fontSize: '13.5px', color: 'var(--ink3)', fontWeight: 600 }}>{m.rangeText}</span>}
      {m.pages > 1 && (
        <div class="pbtns">
          <button class="rbtn" onClick={m.prev} disabled={m.page === 0} aria-label="Vorherige Seite">
            <I.ChevronLeft />
          </button>
          <span aria-live="polite">{m.pageText}</span>
          <button class="rbtn" onClick={m.next} disabled={m.page >= m.pages - 1} aria-label="Nächste Seite">
            <I.ChevronRight size={18} sw={2.4} />
          </button>
        </div>
      )}
    </div>
  );
}

export function SyncButton({ m }: { m: Model }) {
  return (
    <button class={`pri ${m.online ? '' : 'offl'}`} onClick={m.onSync} disabled={m.btnDisabled}>
      {m.syncing && <I.Refresh size={18} sw={2.4} class="spin" />}
      {m.btnLabel}
    </button>
  );
}

/** Hinweise außerhalb des Designs: Verbindung weg, Scan-Fehler, Aktion fehlgeschlagen. */
export function Banners({ m }: { m: Model }) {
  const items: string[] = [];
  if (!m.connected) items.push('Verbindung zum Server getrennt – verbinde neu …');
  if (m.scan.error) items.push(m.scan.error);
  if (m.actionError) items.push(m.actionError);
  return (
    <>
      {items.map((text) => (
        <div class="banner" role="alert" key={text}>
          <I.Info />
          {text}
        </div>
      ))}
    </>
  );
}

export function RescanButton({ m }: { m: Model }) {
  return (
    <button class="rbtn" onClick={m.rescan} disabled={m.scan.running} aria-label="Ordner neu einlesen" title="Ordner neu einlesen">
      <I.Refresh size={18} sw={2.2} class={m.scan.running ? 'spin' : undefined} />
    </button>
  );
}

/** Bottom-Sheet (mobil) mit Fokusführung und Escape. */
export function SheetDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <>
      <button class="scrim" onClick={onClose} aria-label="Schließen" tabIndex={-1} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="handle" />
        <div class="shh">
          <h2>{title}</h2>
          <button class="xbtn" onClick={onClose} aria-label="Schließen">
            <I.Close />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
