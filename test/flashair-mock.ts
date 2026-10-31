import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Minimaler FlashAir-Nachbau für Integrationstests: command.cgi (op=100/108/140)
// und upload.cgi (WRITEPROTECT, FTIME, UPDIR, DEL, POST-Upload).

export interface MockFile {
  data: Buffer;
  /** FAT-Attribut (32 = Archiv, 16 = Verzeichnis, 2 = versteckt, 1 = schreibgeschützt) */
  attr: number;
}

export interface FlashAirMock {
  url: string;
  ip: string;
  /** Dateien im Wurzelverzeichnis, Name → Inhalt */
  files: Map<string, MockFile>;
  capacityBytes: number;
  uploads: string[];
  deletes: string[];
  /** Nach so vielen Uploads antwortet die Karte nicht mehr (Abbruch simulieren) */
  failAfterUploads: number | null;
  close(): Promise<void>;
}

function multipartFile(body: Buffer, contentType: string): { name: string; data: Buffer } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const start = body.indexOf(marker) + marker.length + 2;
  const headerEnd = body.indexOf('\r\n\r\n', start);
  const headers = body.subarray(start, headerEnd).toString();
  const name = /filename="([^"]+)"/.exec(headers)?.[1];
  const end = body.indexOf(marker, headerEnd);
  if (!name) return null;
  return { name, data: body.subarray(headerEnd + 4, end - 2) };
}

export async function startFlashAirMock(): Promise<FlashAirMock> {
  const mock = {
    files: new Map<string, MockFile>(),
    capacityBytes: 64 * 1024 * 1024,
    uploads: [] as string[],
    deletes: [] as string[],
    failAfterUploads: null as number | null,
  };
  const used = () => [...mock.files.values()].reduce((sum, f) => sum + f.data.length, 0);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://card');
    const ok = (text: string) => res.end(text);

    if (url.pathname === '/command.cgi') {
      const op = url.searchParams.get('op');
      if (op === '108') return ok('F15DBW3BW4.00.02');
      if (op === '140') {
        const free = Math.max(0, mock.capacityBytes - used());
        return ok(`${Math.floor(free / 512)}/${Math.floor(mock.capacityBytes / 512)},512`);
      }
      if (op === '100') {
        const lines = ['WLANSD_FILELIST'];
        for (const [name, f] of mock.files) lines.push(`,${name},${f.data.length},${f.attr},23903,20534`);
        return ok(lines.join('\r\n'));
      }
      res.statusCode = 400;
      return ok('ERROR');
    }

    if (url.pathname === '/upload.cgi' && req.method === 'GET') {
      const del = url.searchParams.get('DEL');
      if (del) {
        const name = del.replace(/^\/+/, '');
        mock.deletes.push(name);
        if (!mock.files.delete(name)) return ok('ERROR');
      }
      return ok('SUCCESS');
    }

    if (url.pathname === '/upload.cgi' && req.method === 'POST') {
      if (mock.failAfterUploads !== null && mock.uploads.length >= mock.failAfterUploads) {
        req.socket.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const file = multipartFile(Buffer.concat(chunks), req.headers['content-type'] ?? '');
        if (!file) return ok('ERROR');
        mock.files.set(file.name, { data: file.data, attr: 32 });
        mock.uploads.push(file.name);
        ok('<html><body>SUCCESS</body></html>');
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(mock, {
    url: `http://127.0.0.1:${port}`,
    ip: `127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
