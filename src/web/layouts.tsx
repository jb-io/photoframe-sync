import { useCallback } from 'preact/hooks';
import * as I from './icons.js';
import type { Model } from './model.js';
import {
  AutoWindow,
  Banners,
  DateRange,
  DevicePill,
  FolderGroups,
  InfoBox,
  MiniFrame,
  ModeSwitch,
  Pager,
  RescanButton,
  ScopeSettings,
  SearchField,
  SheetDialog,
  StatusPill,
  SyncButton,
  Timeline,
  ViewSwitch,
} from './parts.js';

function Brand() {
  return (
    <div class="brand">
      <span class="mark">
        <I.Logo />
      </span>
      <span style={{ minWidth: 0 }}>
        <span class="bt">Bilderrahmen</span>
        <span class="bs">Ordner-Sync</span>
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div class="legend" aria-label="Legende">
      <span>Status</span>
      <span class="fs">Auf dem Rahmen</span>
      <span class="fs up">Upload ausstehend</span>
      <span class="fs rm">Wird entfernt</span>
    </div>
  );
}

/** Mobil: eine Spalte, Einstellungen in Bottom-Sheets, Speichern im Dock. */
export function MobileLayout({ m }: { m: Model }) {
  const close = useCallback(() => m.setSheet(null), [m.setSheet]);
  return (
    <div class="app m">
      <header class="top">
        <Brand />
        <DevicePill m={m} />
      </header>

      <main class="scroll">
        <Banners m={m} />
        <section class="card" aria-label="Status des Bilderrahmens">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <MiniFrame m={m} />
            <div style={{ flex: 1, minWidth: 0 }} role="status">
              <StatusPill m={m} />
              <div class="htitle">{m.heroTitle}</div>
              <div class="hsub">{m.st.text}</div>
            </div>
          </div>
          <button class="hrow" onClick={() => m.setSheet('settings')}>
            <I.Sliders />
            Übertragung
            <span class="v">{m.scopeShort}</span>
            <I.ChevronRight />
          </button>
        </section>

        <ModeSwitch m={m} />

        {!m.auto && (
          <div class="srow">
            <SearchField m={m} placeholder="Ordner suchen" />
            <button
              class={`calbtn ${m.hasRange ? 'on' : ''}`}
              onClick={() => m.setSheet('filter')}
              aria-label={m.hasRange ? 'Zeitraum-Filter aktiv – bearbeiten' : 'Zeitraum filtern'}
            >
              <I.Calendar />
              {m.hasRange ? 'Gefiltert' : 'Zeitraum'}
            </button>
          </div>
        )}

        {m.auto && (
          <section class="card" aria-label="Automatischer Zeitraum">
            <AutoWindow m={m} />
          </section>
        )}

        <div class="tools">
          <ViewSwitch m={m} />
        </div>

        {m.isEmpty && <div class="empty">{m.emptyText}</div>}
        <FolderGroups m={m} />
        <Pager m={m} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', color: 'var(--ink3)' }}>
          <RescanButton m={m} />
          <span>{m.scan.running ? 'Ordner werden eingelesen …' : 'Ordner neu einlesen'}</span>
        </div>
      </main>

      <div class="dock">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span class="dt">
            {m.selCount} Ordner · {m.selItems} Bilder
          </span>
          <span class="ds">{m.footSummary}</span>
        </div>
        <SyncButton m={m} />
      </div>

      {m.sheet === 'filter' && (
        <SheetDialog title="Zeitraum filtern" onClose={close}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Timeline m={m} />
            <div style={{ fontSize: '12.5px', color: 'var(--ink3)' }}>{m.tlHint} · wischen für ältere Jahre</div>
          </div>
          <DateRange m={m} />
          <InfoBox icon="calendar">{m.relText}</InfoBox>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class="sec" onClick={m.resetFilter}>
              Zurücksetzen
            </button>
            <button class="pri" style={{ flex: 1 }} onClick={close}>
              {m.showText}
            </button>
          </div>
        </SheetDialog>
      )}

      {m.sheet === 'settings' && (
        <SheetDialog title="Übertragung" onClose={close}>
          <ScopeSettings m={m} />
          <button class="pri" onClick={close}>
            Fertig
          </button>
        </SheetDialog>
      )}
    </div>
  );
}

/** Desktop: Kopfleiste mit Status und Speichern, links Auswahl und Übertragung. */
export function DesktopLayout({ m }: { m: Model }) {
  return (
    <div class="app d">
      <header class="hdr">
        <div class="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px', paddingTop: '14px', paddingBottom: '14px' }}>
          <div style={{ flex: '0 0 auto' }}>
            <Brand />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '14px' }} role="status">
            <MiniFrame m={m} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <StatusPill m={m} />
                <span class="htitle">{m.heroTitle}</span>
              </div>
              <div class="hsub">{m.st.text}</div>
            </div>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <DevicePill m={m} withLabel />
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '16px', marginLeft: 'auto' }}>
            <div>
              <span class="dt">
                {m.selCount} Ordner · {m.selItems} Bilder
              </span>
              <span class="ds">{m.footSummary}</span>
            </div>
            <SyncButton m={m} />
          </div>
        </div>
      </header>

      <div class="wrap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '28px', paddingTop: '28px', paddingBottom: '48px' }}>
        <aside style={{ flex: '1 1 360px', maxWidth: '380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <section class="card" aria-label="Auswahl">
            <h2 class="ch">Auswahl</h2>
            <ModeSwitch m={m} />
            {m.auto ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <AutoWindow m={m} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                <SearchField m={m} placeholder="Ordnername suchen" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                  <span class="lbl">Zeitraum filtern</span>
                  <Timeline m={m} />
                  <div style={{ fontSize: '12.5px', color: 'var(--ink3)' }}>{m.tlHint} · seitlich scrollen bis 1991</div>
                </div>
                <DateRange m={m} />
                <InfoBox icon="calendar">{m.relText}</InfoBox>
                <button class="sec" onClick={m.resetFilter}>
                  Filter zurücksetzen
                </button>
              </div>
            )}
          </section>

          <section class="card" aria-label="Übertragung">
            <h2 class="ch">Übertragung</h2>
            <ScopeSettings m={m} />
          </section>
        </aside>

        <main style={{ flex: '999 1 560px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <ViewSwitch m={m} long />
            <span style={{ marginLeft: 'auto', fontSize: '13.5px', color: 'var(--ink3)', fontWeight: 600 }}>{m.resultText}</span>
            {!m.auto && (
              <button class="link" onClick={m.clearSel}>
                Auswahl leeren
              </button>
            )}
            {m.auto && (
              <span class="chip">
                <I.AutoIcon size={16} />
                {m.winLabel}
              </span>
            )}
            <RescanButton m={m} />
          </div>
          <Legend />
          <Banners m={m} />

          {m.isEmpty && <div class="empty">{m.emptyText}</div>}
          <FolderGroups m={m} desktop />
          <Pager m={m} desktop />
        </main>
      </div>
    </div>
  );
}
