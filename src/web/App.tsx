import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '../shared/types.js';
import { DesktopLayout, MobileLayout } from './layouts.js';
import { useModel } from './model.js';
import { server } from './store.js';

const DESKTOP_QUERY = '(min-width: 1024px)';

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function Loaded({ snap }: { snap: Snapshot }) {
  const m = useModel(snap);
  const desktop = useMedia(DESKTOP_QUERY);
  return desktop ? <DesktopLayout m={m} /> : <MobileLayout m={m} />;
}

export function App() {
  const snap = server.value;
  if (!snap) {
    return (
      <div class="app m" style={{ display: 'grid', placeItems: 'center' }}>
        <p style={{ color: 'var(--ink3)', fontWeight: 600 }} role="status">
          Verbinde …
        </p>
      </div>
    );
  }
  return <Loaded snap={snap} />;
}
