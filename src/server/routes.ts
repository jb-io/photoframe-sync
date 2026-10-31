import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { ServerMessage } from '../shared/types.js';
import { PER_FOLDER_MAX, PER_FOLDER_MIN, WINDOW_MAX, WINDOW_MIN } from '../shared/types.js';
import type { Core } from './core.js';

const selectionSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  windowMonths: z.number().int().min(WINDOW_MIN).max(WINDOW_MAX),
  manual: z.array(z.string().regex(/^[0-9a-f]{16}$/)).max(100_000),
  scope: z.enum(['all', 'limit']),
  perFolder: z.number().int().min(PER_FOLDER_MIN).max(PER_FOLDER_MAX),
});

const foldersQuery = z.object({
  q: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(0).max(10_000).default(24),
});

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerRoutes(app: FastifyInstance, core: Core): Promise<void> {
  const clients = new Set<WebSocket>();
  const broadcast = (message: ServerMessage) => {
    if (clients.size === 0) return;
    const data = JSON.stringify(message);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  core.on('message', broadcast);
  app.addHook('onClose', async () => {
    core.off('message', broadcast);
  });

  app.get('/api/health', async () => ({ status: 'ok', version: core.version, uptimeSec: Math.round(process.uptime()) }));

  app.get('/api/state', async () => core.snapshot());

  /** Ordnerliste mit Filter und Paginierung (size=0: alle). */
  app.get('/api/folders', async (req, reply) => {
    const parsed = foldersQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Parameter' });
    const { q, from, to, page, size } = parsed.data;
    const needle = q?.trim().toLowerCase();
    const list = core
      .snapshot()
      .folders.filter((f) => (!from || f.date >= from) && (!to || f.date <= to) && (!needle || f.name.toLowerCase().includes(needle)));
    const items = size ? list.slice((page - 1) * size, page * size) : list;
    return { total: list.length, page, size, items };
  });

  app.put('/api/selection', async (req, reply) => {
    const parsed = selectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ungültige Auswahl', issues: parsed.error.issues });
    core.saveSelection(parsed.data);
    return { selection: parsed.data, plan: core.plan, sync: core.sync };
  });

  app.post('/api/scan', async (_req, reply) => {
    void core.runScan();
    return reply.code(202).send({ started: true });
  });

  app.post('/api/sync', async (_req, reply) => {
    if (!core.device.cardConfigured) return reply.code(409).send({ error: 'FLASHAIR_IP ist nicht gesetzt' });
    if (!core.device.cardOnline) return reply.code(409).send({ error: 'Rahmen ist offline' });
    core.requestSync('manuell');
    return reply.code(202).send({ started: true });
  });

  app.post('/api/shuffle', async (_req, reply) => {
    core.shuffle();
    return reply.code(202).send({ started: true });
  });

  app.post('/api/power', async (req, reply) => {
    const parsed = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Erwartet {"on": true|false}' });
    if (!core.device.powerConfigured) return reply.code(404).send({ error: 'SHELLY_IP ist nicht gesetzt' });
    try {
      await core.setPower(parsed.data.on);
      return { device: core.device };
    } catch (err) {
      req.log.warn({ err }, 'Schalten fehlgeschlagen');
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/power/restart', async (req, reply) => {
    if (!core.device.powerConfigured) return reply.code(404).send({ error: 'SHELLY_IP ist nicht gesetzt' });
    try {
      await core.restartFrame('App');
      return { device: core.device };
    } catch (err) {
      req.log.warn({ err }, 'Neustart fehlgeschlagen');
      return reply.code(core.device.power === true ? 502 : 409).send({ error: (err as Error).message });
    }
  });

  /** Webhook des Shelly nach dem Einschalten (FA-37). Antwortet sofort. */
  app.get('/api/hooks/power-on', async (req, reply) => {
    const token = core.cfg.webhookToken;
    if (token && !tokenMatches(token, (req.query as Record<string, unknown>).token)) {
      req.log.warn('Webhook mit ungültigem Token abgelehnt');
      return reply.code(403).send({ error: 'Ungültiges Token' });
    }
    const result = core.powerOnHook();
    req.log.info(result, 'Webhook power-on');
    return reply.code(202).send({ scheduled: true, ...result });
  });

  app.get<{ Params: { id: string } }>('/api/thumbs/:id', async (req, reply) => {
    const folder = core.folderById(req.params.id);
    if (!folder) return reply.code(404).send({ error: 'Ordner unbekannt' });
    const first = core.store.images(folder.id)[0];
    if (!first) return reply.code(404).send({ error: 'Ordner enthält keine Bilder' });
    try {
      const file = await core.cache.ensureThumb(folder.id, first.rel, first.mtimeMs);
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(fs.createReadStream(file));
    } catch (err) {
      req.log.warn({ err, folder: folder.path }, 'Vorschau fehlgeschlagen');
      return reply.code(500).send({ error: 'Vorschau fehlgeschlagen' });
    }
  });

  app.get('/api/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    // Nach jedem (Re-)Connect: vollständiger Stand (FA-40).
    socket.send(JSON.stringify({ type: 'snapshot', ...core.snapshot() } satisfies ServerMessage));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
