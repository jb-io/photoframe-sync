import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Shelly-Gen3-Nachbau: Switch.GetStatus und Switch.Set (inkl. toggle_after).
// `onTurnedOn` entspricht der Shelly-Action „Switch turned on“ (Webhook).

export interface ShellyMock {
  ip: string;
  output: boolean;
  /** Aufrufe von Switch.Set mit on=false und toggle_after */
  restarts: number;
  onTurnedOn: () => void;
  onRestart: () => void;
  close(): Promise<void>;
}

export async function startShellyMock(): Promise<ShellyMock> {
  const timers = new Set<NodeJS.Timeout>();
  const mock = { output: true, restarts: 0, onTurnedOn: () => {}, onRestart: () => {} };

  const turn = (on: boolean) => {
    const was = mock.output;
    mock.output = on;
    if (on && !was) mock.onTurnedOn();
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://shelly');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rpc/Switch.GetStatus') return res.end(JSON.stringify({ id: 0, output: mock.output }));
    if (url.pathname === '/rpc/Switch.Set') {
      const was = mock.output;
      const on = url.searchParams.get('on') === 'true';
      const toggleAfter = Number(url.searchParams.get('toggle_after'));
      turn(on);
      if (toggleAfter > 0) {
        if (!on) {
          mock.restarts += 1;
          mock.onRestart();
        }
        const t = setTimeout(() => turn(!on), toggleAfter * 1000);
        timers.add(t);
      }
      return res.end(JSON.stringify({ was_on: was }));
    }
    res.statusCode = 404;
    res.end('{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(mock, {
    ip: `127.0.0.1:${port}`,
    close: () => {
      for (const t of timers) clearTimeout(t);
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}
