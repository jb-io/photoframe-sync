import { batch, signal } from '@preact/signals';
import type { Selection, ServerMessage, Snapshot } from '../shared/types.js';

/** Letzter Stand vom Server; null bis zum ersten Snapshot. */
export const server = signal<Snapshot | null>(null);
export const connected = signal(false);
/** Letzte Fehlermeldung einer Aktion (Schalten, Speichern …) */
export const actionError = signal<string | null>(null);

type Listener = (message: ServerMessage) => void;
const listeners = new Set<Listener>();

/** Für Komponenten, die auf einzelne Ereignisse reagieren (z. B. gespeicherte Auswahl). */
export function onServerMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(message: ServerMessage): void {
  const current = server.value;
  if (message.type === 'snapshot') {
    const { type: _type, ...snapshot } = message;
    server.value = snapshot;
  } else if (current) {
    switch (message.type) {
      case 'folders':
        server.value = { ...current, folders: message.folders, scan: message.scan };
        break;
      case 'scan':
        server.value = { ...current, scan: message.scan };
        break;
      case 'selection':
        server.value = { ...current, selection: message.selection, plan: message.plan };
        break;
      case 'frame':
        server.value = { ...current, frame: message.frame };
        break;
      case 'device':
        server.value = { ...current, device: message.device };
        break;
      case 'sync':
        server.value = { ...current, sync: message.sync };
        break;
      case 'plan':
        server.value = { ...current, plan: message.plan, today: message.today };
        break;
    }
  }
  for (const listener of listeners) listener(message);
}

/** Eine WebSocket-Verbindung mit automatischem Reconnect und Backoff (FA-40). */
export function connect(): void {
  let attempt = 0;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => {
      attempt = 0;
      connected.value = true;
    };
    ws.onmessage = (event) => {
      try {
        batch(() => apply(JSON.parse(event.data as string) as ServerMessage));
      } catch (err) {
        console.error('Ungültige Nachricht', err);
      }
    };
    ws.onclose = () => {
      connected.value = false;
      const delay = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 300;
      attempt += 1;
      setTimeout(open, delay);
    };
    ws.onerror = () => ws.close();
  };
  open();
}

async function call(method: string, url: string, body?: unknown): Promise<void> {
  actionError.value = null;
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
  } catch (err) {
    actionError.value = (err as Error).message;
    throw err;
  }
}

export const api = {
  saveSelection: (selection: Selection) => call('PUT', '/api/selection', selection),
  syncNow: () => call('POST', '/api/sync'),
  scan: () => call('POST', '/api/scan'),
  shuffle: () => call('POST', '/api/shuffle'),
  power: (on: boolean) => call('POST', '/api/power', { on }),
  restart: () => call('POST', '/api/power/restart'),
};
