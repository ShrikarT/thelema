import http, { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SandboxMarket, MarketError } from '../../packages/core/market.ts';
import { configuration, readArc, quoteArc } from '../../packages/arc/client.ts';
import { getReferences } from '../../packages/graph/index.mjs';
import { clipNotional, requestConfidentialClip } from '../../packages/cre/index.mjs';
import type { ArcConfig } from '../../packages/arc/types.ts';
import type { QuoteInput, PairsInput, SandboxMarketOptions, TradeInput } from '../../packages/core/types.ts';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));

const exact = (a?: string, b?: string): boolean =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface SessionData {
  csrf: string;
  market: SandboxMarket;
  seen: number;
  window: number;
  count: number;
  clipWindow: number;
  clips: number;
}

export interface AppOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof globalThis.fetch;
}

export interface HostOriginConfig {
  appHost?: string;
  appOrigin?: string;
}

export function resolveHostAndOrigin(env: Record<string, string | undefined>): HostOriginConfig {
  let appHost: string | undefined = (env.APP_HOST || env.RENDER_EXTERNAL_HOSTNAME || '').trim();
  if (appHost) {
    const hostRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?::\d{1,5})?$|^localhost(?::\d{1,5})?$|^127\.0\.0\.1(?::\d{1,5})?$/;
    if (!hostRegex.test(appHost)) {
      throw new Error(`Invalid APP_HOST or RENDER_EXTERNAL_HOSTNAME: "${appHost}"`);
    }
  } else {
    appHost = undefined;
  }

  let appOrigin: string | undefined = (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || '').trim();
  if (!appOrigin && appHost) {
    appOrigin = `https://${appHost}`;
  }
  if (appOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(appOrigin);
    } catch {
      throw new Error(`Invalid APP_ORIGIN or RENDER_EXTERNAL_URL: "${appOrigin}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`APP_ORIGIN must have http or https protocol: "${appOrigin}"`);
    }
    appOrigin = parsed.origin;
  } else {
    appOrigin = undefined;
  }

  return { appHost, appOrigin };
}

export function createApp({ env = process.env, fetchImpl = fetch }: AppOptions = {}): Server {
  const sessions = new Map<string, SessionData>();
  const config: ArcConfig = configuration(env);
  const TTL = 4 * 60 * 60 * 1000;
  const { appHost, appOrigin } = resolveHostAndOrigin(env);

  const json = (res: ServerResponse, status: number, data: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    );

    const host = req.headers.host || '';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    if (!local && (!appHost || host !== appHost)) {
      return json(res, 421, { error: 'Unexpected host.' });
    }

    let url: URL;
    try {
      url = new URL(req.url || '/', `http://${host}`);
    } catch {
      return json(res, 400, { error: 'Invalid URL.' });
    }

    if (url.pathname === '/api/health') {
      return json(res, 200, { status: 'ok', app: 'THELEMA', mode: 'local-research', liveEvidence: false });
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        const now = Date.now();
        for (const [id, s] of sessions) {
          if (now - s.seen > TTL) sessions.delete(id);
        }

        const id = (req.headers.cookie || '')
          .split(';')
          .map(x => x.trim())
          .find(x => x.startsWith('thelema_sid='))
          ?.slice(12);
        let session = id ? sessions.get(id) : undefined;

        if (!session) {
          if (req.method !== 'GET' || url.pathname !== '/api/config') {
            return json(res, 401, { error: 'Initialize the session first.' });
          }
          if (sessions.size >= 1000) {
            return json(res, 503, { error: 'Session capacity reached. Please retry later.' });
          }
          const sid = randomBytes(24).toString('hex');
          session = {
            csrf: randomBytes(24).toString('hex'),
            market: new SandboxMarket(),
            seen: now,
            window: now,
            count: 0,
            clipWindow: now,
            clips: 0
          };
          sessions.set(sid, session);
          const isSecure = appOrigin ? appOrigin.startsWith('https:') : false;
          res.setHeader(
            'Set-Cookie',
            `thelema_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${isSecure ? '; Secure' : ''}`
          );
        }

        session.seen = now;
        if (now - session.window > 60000) {
          session.window = now;
          session.count = 0;
        }
        if (++session.count > 120) {
          return json(res, 429, { error: 'Request limit reached. Retry in one minute.' });
        }

        if (req.method === 'GET') {
          if (url.pathname === '/api/config') {
            const { rpcUrl: _omittedRpcUrl, ...clientConfig } = config;
            return json(res, 200, { ...clientConfig, csrf: session.csrf });
          }
          if (url.pathname === '/api/market') {
            const mode = url.searchParams.get('mode') || 'sandbox';
            if (mode !== 'sandbox' && mode !== 'arc') throw new MarketError('Unknown execution mode.');
            return json(res, 200, mode === 'sandbox' ? session.market.snapshot() : await readArc(config));
          }
          if (url.pathname === '/api/references') return json(res, 200, await getReferences({ env, fetchImpl, includeCrossProtocol: true }));
          return json(res, 404, { error: 'Unknown API route.' });
        }

        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

        const origin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site') {
          return json(res, 403, { error: 'Cross-origin request blocked.' });
        }
        if (origin) {
          const allowedOrigin = appOrigin || (local ? `http://${host}` : undefined);
          if (!allowedOrigin || origin !== allowedOrigin) {
            return json(res, 403, { error: 'Cross-origin request blocked.' });
          }
        }
        if (!exact(req.headers['x-csrf-token'] as string | undefined, session.csrf)) {
          return json(res, 403, { error: 'Invalid session token. Reload the app.' });
        }
        if (!String(req.headers['content-type']).startsWith('application/json')) {
          return json(res, 415, { error: 'JSON body required.' });
        }
        if (Number(req.headers['content-length']) > 16384) {
          return json(res, 413, { error: 'Request body too large.' });
        }

        let raw = '';
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16384) throw new MarketError('Request body too large.', 'BODY_SIZE', 413);
          raw += chunk;
        }

        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new MarketError('Invalid JSON body.');
        }
        if (!data || Array.isArray(data) || typeof data !== 'object') {
          throw new MarketError('JSON object required.');
        }

        const bodyObj = data as Record<string, unknown>;

        if (url.pathname === '/api/sandbox/quote') return json(res, 200, session.market.quote(bodyObj as unknown as QuoteInput));
        if (url.pathname === '/api/sandbox/trade') return json(res, 200, session.market.trade(bodyObj as unknown as TradeInput));
        if (url.pathname === '/api/sandbox/pairs') return json(res, 200, session.market.pairs(bodyObj as unknown as PairsInput));
        if (url.pathname === '/api/sandbox/resolve-event') return json(res, 200, session.market.resolveEvent(bodyObj as unknown as { eventYes: boolean }));
        if (url.pathname === '/api/sandbox/fix-price') return json(res, 200, session.market.fixPrice(bodyObj as unknown as { spot: string }));
        if (url.pathname === '/api/sandbox/settle') return json(res, 200, session.market.settle(bodyObj as unknown as { eventYes: boolean; spot: string }));
        if (url.pathname === '/api/sandbox/claim') return json(res, 200, session.market.claim());
        if (url.pathname === '/api/sandbox/reset') {
          let opts: SandboxMarketOptions = {};
          if (bodyObj.timingPolicy === 'accelerated-demo') {
            const t = Date.now();
            opts = { timingPolicy: 'accelerated-demo', tradingCutoff: t + 60000, eventDeadline: t + 120000, earliestPriceFixTime: t + 120000 };
          } else if (bodyObj.timingPolicy) {
            opts = bodyObj as unknown as SandboxMarketOptions;
          }
          session.market = new SandboxMarket(opts);
          return json(res, 200, session.market.snapshot());
        }
        if (url.pathname === '/api/arc/quote') return json(res, 200, await quoteArc(config, bodyObj as unknown as QuoteInput));
        if (url.pathname === '/api/clip') {
          if (now - session.clipWindow > 60000) {
            session.clipWindow = now;
            session.clips = 0;
          }
          if (++session.clips > 15) return json(res, 429, { error: 'Size policy limit reached. Retry in one minute.' });
          if (bodyObj.mode !== 'arc' && bodyObj.mode !== 'sandbox') throw new MarketError('Specify the clipping execution mode.');
          if (bodyObj.mode === 'sandbox') return json(res, 200, clipNotional({ requestedSize: String(bodyObj.requestedSize ?? ''), maxNotional: '50' }));
          try {
            return json(res, 200, await requestConfidentialClip(String(bodyObj.requestedSize ?? ''), { env, fetchImpl }));
          } catch {
            return json(res, 503, { error: 'Confidential clipping is unavailable or rejected the response. No local fallback was used.' });
          }
        }
        return json(res, 404, { error: 'Unknown API route.' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const routes = ['/', '/market', '/portfolio', '/guide'];
      let file = 'index.html';
      let status = routes.includes(url.pathname) ? 200 : 404;

      if (url.pathname.startsWith('/assets/')) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(url.pathname);
        } catch {
          throw new MarketError('Invalid path.');
        }
        file = decoded.slice(1);
        status = 200;
      } else if (url.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('User-agent: *\nDisallow: /\n');
      } else if (url.pathname.startsWith('/.') || /\.(env|md|json|sol|ts|mjs)$/.test(url.pathname)) {
        return json(res, 404, { error: 'Not found.' });
      }

      const resolved = path.resolve(publicDir, file);
      if (!resolved.startsWith(publicDir) || !['.html', '.js', '.css', '.svg', '.woff', '.woff2', '.webp', '.png'].includes(path.extname(resolved))) {
        return json(res, 404, { error: 'Not found.' });
      }

      let content: Buffer;
      try {
        content = await readFile(resolved);
      } catch {
        return json(res, 404, { error: 'Asset not found. Run npm run build.' });
      }

      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.webp': 'image/webp',
        '.png': 'image/png'
      };
      res.writeHead(status, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': file === 'index.html' ? 'no-store' : 'public, max-age=3600'
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (e: unknown) {
      const known = e instanceof MarketError;
      json(res, known ? e.status : 500, {
        error: known ? e.message : 'Request failed. Check configuration and retry.',
        code: known ? e.code : 'REQUEST_FAILED'
      });
    }
  });

  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {}
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () =>
    console.log(`THELEMA local server listening on http://${host}:${port} — sandbox default, live integrations not implied.`)
  );
}
