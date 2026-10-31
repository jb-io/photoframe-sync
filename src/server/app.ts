import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import type { Core } from './core.js';
import type { Logger } from './log.js';
import { registerRoutes } from './routes.js';

/** Pfade, die bei aktiver Umleitung weiter über HTTP antworten (Shelly-Webhook, Docker-Healthcheck). */
const HTTP_ONLY_PREFIXES = ['/api/hooks/', '/api/health'];

export interface AppOptions {
  /** Statische Oberfläche (dist/web), falls gebaut */
  webDir?: string;
  /** HTTPS-Server mit diesem Schlüssel/Zertifikat */
  tls?: { key: string; cert: string };
  /** HTTP: Oberfläche auf diesen HTTPS-Port umleiten (der Port, den der Browser erreicht) */
  redirectToHttpsPort?: number;
}

/** Fastify-Instanz mit API, WebSocket und Oberfläche – für HTTP und HTTPS gleich aufgebaut. */
export async function buildApp(core: Core, log: Logger, opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: log.child({ mod: opts.tls ? 'https' : 'http' }) as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    ...(opts.tls ? { https: { key: opts.tls.key, cert: opts.tls.cert } } : {}),
  }) as unknown as FastifyInstance;

  const httpsPort = opts.redirectToHttpsPort;
  if (httpsPort) {
    app.addHook('onRequest', async (req, reply) => {
      if (HTTP_ONLY_PREFIXES.some((p) => req.url.startsWith(p))) return;
      // Host ohne Port; IPv6-Adressen behalten ihre Klammern.
      let host: string;
      try {
        host = new URL(`http://${req.headers.host ?? 'localhost'}`).hostname;
      } catch {
        return reply.code(400).send({ error: 'Ungültiger Host-Header' });
      }
      return reply.redirect(`https://${host}:${httpsPort}${req.url}`, 308);
    });
  }

  await app.register(fastifyWebsocket);
  await registerRoutes(app, core);

  if (opts.webDir && fs.existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
